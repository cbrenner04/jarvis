# Pipeline ownership and orphan settlement in the store

Slice 2c of [per-project pipelines](../per-project-pipelines-brief.md), store layer.

## Problem

`pipelines` rows carry no owner and no settlement marker, so a pipeline admitted by a daemon
that later exits is indistinguishable from one a live daemon is still driving. Nothing can
settle it without either deleting state or fabricating completion.

## Decisions

- A new forward-only migration (following `013-pipelines-and-stages`) adds `pipelines.owner_identity`
  (`TEXT`, nullable, no default — same shape as `011-run-owner-identity`'s `runs.owner_identity`) and
  `pipelines.status` (`TEXT NOT NULL DEFAULT 'active'`, satisfying SQLite's `ADD COLUMN` default
  requirement).
- `pipelines.status` vocabulary is exactly: `'active'` (set at admission; a live or not-yet-reconciled
  pipeline) and `'interrupted'` (set by settlement); this slice introduces no other pipeline status
  value. `'interrupted'` is the only terminal pipeline status this slice defines. `01` references this
  vocabulary rather than restating it.
- `createPipeline` stamps `owner_identity` with the calling process's `<pid>:<start-epoch>` identity,
  reusing the run-row owner identity and liveness probe, and sets `status = 'active'`. As with
  `createRun`, the caller is assumed to be the daemon process itself — a short-lived CLI admitter
  would self-orphan its own pipelines on the next startup, which is out of scope for this slice.
  Rules out a pipeline-specific ownership scheme and rules out treating every non-terminal pipeline
  as orphaned.
- A `NULL` `owner_identity` is treated as orphaned with no liveness probe, matching
  `beginRunReconciliation`'s handling of `ownerIdentity === null` (`state-store.ts:753`); there is no
  backfill path for rows created before this migration.
- Pipeline settlement is a stored `pipelines.status` column, not derived from stages; a pipeline
  settled `interrupted` still holds `pending` stages, which a stage-derived status cannot express.
  This supersedes the "no pipeline-level status column" contract in `v2/docs/state-store.md`.
- Reconciliation classifies a stage by its existing `pipeline_stages.status`: `pending` is
  undispatched, `succeeded`/`failed`/`interrupted` are terminal, and any other value is active. This
  supersedes the "free-form string, daemon consumer defines the vocabulary" contract in
  `v2/docs/state-store.md` for these five values; the store now depends on this vocabulary to decide
  what to touch. Rules out hard-coding a single dispatched-stage status this slice does not own.
- Settling an orphan marks the pipeline `interrupted`, marks each active stage `interrupted` with an
  end timestamp, and touches no `pending` or already-terminal stage; rules out deleting rows,
  fabricating success, or cascading later stages into a terminal status. This applies uniformly
  whether the dead owner left an active stage (mid-stage exit), no active stage with later stages
  `pending` (died between stages), or every stage already terminal (died after its last stage
  finished, before the pipeline itself was marked terminal) — in all three shapes only the pipeline
  row's status changes to `interrupted`; no stage already `succeeded`/`failed`/`interrupted` is
  touched, and no `pending` stage is fabricated as complete.
- Settlement of all orphans plus their stages runs in one transaction; rules out a partially settled
  pipeline surviving a mid-sweep fault.
- A pipeline whose owner is the current process is never settled; this matches the ownership/liveness
  predicate `beginRunReconciliation` uses (dead-incarnation check via `<pid>:<start-epoch>`), not its
  event/flag behavior (see the observability deferral below). Rules out a daemon reaping its own live
  work.
- The sweep is idempotent: re-running it against a pipeline already settled `interrupted` (recorded
  owner dead or absent, status already `interrupted`) changes nothing — the terminal-status guard, not
  a reachable "completed/failed pipeline" fixture, is what a test can construct, since nothing in this
  slice ever writes `completed`/`failed` pipeline status.
- No consumer today calls `createPipeline`, `updateStage`, or derives pipeline status from stages
  outside tests; every acceptance criterion below is exercised against rows a test seeds directly.
- Deferred: pipeline reconciliation emits no event and sets no pending-flag column, unlike
  `beginRunReconciliation`'s `run_reconciled`/`reconciliation_pending` — no pipeline log stream or
  consumer of returned IDs exists yet. Pin when one does.
- Deferred to first consumer: whether settled-interrupted pipelines are re-admitted or resumed — pin
  when stage-scoped pipeline resume exists.

## Acceptance criteria

- [x] `createPipeline` records the admitting process identity in `owner_identity` and `status =
      'active'` on the pipeline row; `loadPipeline` reads both back after closing and reopening a
      file-backed store.
- [x] The store exposes a pipeline reconciliation sweep that settles a pipeline whose recorded owner
      is a dead prior incarnation, or which has a `NULL` owner, and returns the settled pipeline IDs.
- [x] Settlement marks the pipeline `status = 'interrupted'` and its active stage `interrupted` with an
      end timestamp; the full stage rows returned by `loadPipeline` for every prior `succeeded`,
      `failed`, or `interrupted` stage are byte-for-byte identical before and after the sweep, and every
      `pending` stage remains `pending` with null `workflow_invocation_id`/`started_at`/`ended_at`/
      `artifact`/`failure_detail`.
- [x] A pipeline owned by a still-live different process, and a pipeline owned by the current
      process, are both returned unsettled and unchanged.
- [x] Re-running the sweep against a pipeline already settled `interrupted` (dead or absent owner)
      leaves that pipeline's `status` and every one of its stage rows unchanged, and the pipeline ID
      is not returned a second time.
- [x] A dead-owner pipeline with no active stage — either all stages already terminal, or later
      stages `pending` with none active — is settled `interrupted` with every stage row unchanged.
- [x] `v2/src/persistence/state-store.test.ts` covers dead-owner settlement, live-owner preservation,
      and re-sweep idempotence against seeded pipelines, fails against the pre-change store, and
      passes after.
- [x] Inverting either the ownership-liveness guard or the terminal-status (idempotence) guard turns
      those regressions RED; the live-owner case proves no stage row was written.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — pipeline `owner_identity`/`status` columns and the `'active'`/
  `'interrupted'` vocabulary, replacing the "no pipeline-level status column" and "stage status is
  free-form, daemon defines the vocabulary" contracts; the stage classification (`pending` /
  terminal / active) the sweep depends on; and the reconciliation operation, its transactional
  scope, and its idempotence.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only state.
