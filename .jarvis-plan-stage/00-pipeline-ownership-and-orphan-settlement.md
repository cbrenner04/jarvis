# Pipeline ownership and orphan settlement in the store

Slice 2c of [per-project pipelines](../per-project-pipelines-brief.md), store layer.

## Problem

`pipelines` rows carry no owner and no settlement marker, so a pipeline admitted by a daemon
that later exits is indistinguishable from one a live daemon is still driving. Nothing can
settle it without either deleting state or fabricating completion.

## Decisions

- Pipeline rows record the admitting process's `<pid>:<start-epoch>` identity, reusing the run-row
  owner identity and liveness probe; rules out a pipeline-specific ownership scheme and rules out
  treating every non-terminal pipeline as orphaned.
- Pipeline settlement is a stored `pipelines.status` column, not derived from stages; a pipeline
  settled as interrupted still holds `pending` stages, which a stage-derived status cannot express.
  This supersedes the "no pipeline-level status column" contract in `v2/docs/state-store.md`.
- Reconciliation classifies a stage by status: `pending` is undispatched, `succeeded`/`failed`/`interrupted`
  are terminal, and any other value is active; rules out hard-coding a single dispatched-stage
  status this slice does not own.
- Settling an orphan marks the pipeline `interrupted`, marks each active stage `interrupted` with an
  end timestamp, and touches no terminal or `pending` stage; rules out deleting rows, fabricating
  success, or cascading later stages into a terminal status.
- Settlement of all orphans plus their stages runs in one transaction; rules out a partially settled
  pipeline surviving a mid-sweep fault.
- A pipeline whose owner is the current process is never settled, matching `beginRunReconciliation`;
  rules out a daemon reaping its own live work.
- Deferred to first consumer: whether settled-interrupted pipelines are re-admitted or resumed — pin
  when stage-scoped pipeline resume exists.

## Acceptance criteria

- [ ] `createPipeline` records the admitting process identity and an initial non-terminal status on
      the pipeline row; `loadPipeline` reads both back after closing and reopening a file-backed store.
- [ ] The store exposes a pipeline reconciliation sweep that settles a pipeline whose recorded owner
      is a dead prior incarnation, or which has no recorded owner, and returns the settled pipeline IDs.
- [ ] Settlement marks the pipeline and its active stage `interrupted` with an end timestamp,
      preserves prior terminal stages byte-for-byte, and leaves later stages `pending` with null
      lifecycle fields.
- [ ] A pipeline owned by a still-live different process, and a pipeline owned by the current
      process, are both returned unsettled and unchanged.
- [ ] A pipeline already in a terminal status is unchanged by the sweep.
- [ ] `v2/src/persistence/state-store.test.ts` covers dead-owner settlement and live-owner
      preservation against a seeded pipeline, fails against the pre-change store, and passes after.
- [ ] Inverting either the ownership-liveness guard or the terminal-status guard turns those
      regressions RED; the live-owner case proves no stage row was written.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — pipeline owner identity column, stored pipeline status replacing the
  derived-status contract, stage classification used by the sweep, and the reconciliation operation.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only state.
