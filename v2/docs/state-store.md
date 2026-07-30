# State store

Durable state for v2 runs and execution history: SQLite at `~/.jarvis/state/v2.sqlite`.

`openStateStore(path?)` creates or opens the file and bootstraps the schema idempotently before any operation; tests pass a path override and write nothing under `~/.jarvis`. Schema changes are forward-only: append migration statements when the first incompatible change lands — never ahead of consumers.

## Concurrency & journal mode

The store opens SQLite with **WAL (Write-Ahead Logging)** journal mode and a 5-second busy timeout, enabling concurrent reader-vs-writer access on a single machine:

- **WAL mode** separates reads from writes: multiple readers can observe committed snapshots while a writer holds an uncommitted transaction (serialization points are commits, not transaction starts).
- **busy_timeout** causes writers to wait up to 5 seconds if a reader holds a lock, rather than failing instantly; this accommodates routine polling (daemon `listRuns`, TUI status checks) during active runs.
- **-wal** and **-shm** sidecar files: WAL requires two additional files alongside the main database (`-wal` for the write-ahead log, `-shm` for shared memory). These must reside on the same filesystem as the main database and be readable/writable by the process. Network filesystems (NFS, cloud drives) are unsupported; single-machine access is guaranteed only. See [On-disk maintenance](#on-disk-maintenance) for backup, purge, and hand-copy.

A failed WAL setup (e.g., restricted filesystems, old SQLite, or sandboxed environments) silently falls back to the default rollback journal; the store remains functional but with reduced concurrency (readers block writers and vice versa).

Overlapping workflows and routine TUI polling are safe against the store on one machine without additional locking or coordination.

## On-disk maintenance

Backup, purge, or hand-copy of the orchestration store must move or delete `v2.sqlite`, `v2.sqlite-wal`, and `v2.sqlite-shm` under `~/.jarvis/state/` together. Copying or removing only the main file can strand committed rows or leave a torn store. In-repo helpers `copyOrchestrationStore` and `removeOrchestrationStore` in [`state-store-on-disk.ts`](../src/persistence/state-store-on-disk.ts) apply the same rule for tests and tooling.

## Schema

- `runs` — orchestration identity, lifecycle, and checkpoint: `id`, `project`, `spec_ref`, `created_at`, `status` (`in-progress` | `completed` | `blocked` | `budget-soft-stopped` | `paused` | `failed` | `interrupted` | `killed` | `queued`), `attempt_count` (durable resume checkpoint), `worktree_path` (reconstructible pointer), `branch` (durable), `spec_path`, `step_id` (nullable, opaque workflow step identifier for multi-step resume tracking), and nullable `workflow_snapshot` JSON (`{ invocationId, steps: [{ stepId, role }] }`) for workflow-backed runs.
- `attempts` — one row per step attempt: `id`, `run_id`, `attempt_number`, `started_at`, `status` (`in-progress` | `completed`), plus the durable outcome once committed: `outcome_kind` (`done` | `no-work` | `progress` | `blocked` | `contract_miss` | `invocation_failure` | `invalid_token`), `completed_at`, and nullable `invocation_failure_detail` JSON (`{ failureKind, bindingAttempts }`) on terminal binding-chain `invocation_failure` only.
- `pipelines` — one row per admitted pipeline: `id`, `name`, `created_at`, immutable `definition` (`PipelineDefinition`) and nullable `context` (`PipelineContext`: `{ cwd, configPath?, targetDir?, projectRegistry?, seed }`) JSON snapshots. Serialization at admission isolates both snapshots from later caller mutation. `owner_identity` (nullable `<pid>:<process-start-epoch>` of the admitting process, stamped by `createPipeline`, same shape as `runs.owner_identity`) and `status` (`'active'` | `'interrupted'`; `'active'` at admission, `'interrupted'` set by `reconcilePipelines` — the only pipeline status this layer defines) back pipeline-restart reconciliation.
- `pipeline_stages` — one row per authored stage, `UNIQUE (pipeline_id, stage_id)` and `UNIQUE (pipeline_id, position)`: `id` (durable row identity), `pipeline_id` (FK, `REFERENCES pipelines(id)`), `stage_id` (preserved authored identity), `position` (authored order, 0-based), `status` (free-form string with conditional approval transitions described below; `reconcilePipelines` treats `pending` as undispatched and `succeeded`/`failed`/`interrupted` as terminal), nullable `workflow_invocation_id`, nullable `started_at`/`ended_at` (Unix epoch milliseconds), and nullable `artifact`/`failure_detail` JSON (schema-free envelopes, opaque to this layer). Lifecycle fields initialize at admission: `status` to `'pending'`, the rest to `NULL`.

The store enables `PRAGMA foreign_keys=ON` on its connection, so `pipeline_stages.pipeline_id → pipelines(id)` and `attempts.run_id → runs(id)` are enforced, not merely declared.

Forward-only migrations:
- `004-invocation-failure-detail` adds `invocation_failure_detail`. Legacy `invocation_failure` rows with null detail omit `failureKind` and `bindingAttempts` on load and idempotent re-entry — no migrate-on-read synthesis.
- `005-run-step-id` adds `step_id` (nullable). Resume key extends from `(project, branch)` to `(project, branch, step_id)`: `step_id` omitted (NULL) yields single-step behavior matching pre-migration runs.
- `006-run-workflow-snapshot` adds `workflow_snapshot` (nullable). Workflow-backed step runs persist authored workflow metadata so daemon/TUI consumers can render pending, active, and completed steps after quiescence.
- `007-run-queued-input` adds `queued_input` (nullable), the persisted `WriteLoopInput` for a run admitted `queued` (memory headroom unavailable at admission).
- `008-attempt-completion-agent` adds `completion_agent` on `attempts`.
- `009-run-creation-title` adds `creation_title` (nullable) on `runs`.
- `010-run-reconciliation-pending` adds `reconciliation_pending` (default `0`) on `runs`, tracking a `run_reconciled` event still owed after a reconciliation kill.
- `011-run-owner-identity` adds `owner_identity` (nullable) on `runs`: `<pid>:<process-start-epoch>` of the process that admitted the row, stamped by `createRun`. No backfill — pre-migration rows read back `NULL`. Not exposed on the `Run` type or `RUN_COLUMNS`; read only internally by reconciliation. See [`daemon-host.md`](daemon-host.md#restart-reconciliation) for the reconciliation predicate this backs.
- `014-pipeline-owner-identity-and-status` adds `owner_identity` (nullable) and `status` (`NOT NULL DEFAULT 'active'`) on `pipelines`. No backfill — pre-migration rows read back `owner_identity = NULL`, `status = 'active'`.
- `015-pipeline-context` adds nullable `context` JSON on `pipelines`. No backfill or reconstruction — pre-migration rows load `context = null`.

## API

Repository-style named ops keyed by durable IDs — no public SQL surface. Signatures: the `StateStore` interface in [`state-store.ts`](../src/persistence/state-store.ts).

- `createRun` — insert a run (`in-progress`, zero attempts); accepts optional `stepId` and optional `workflowSnapshot` for workflow-backed runs; returns its ID.
- `loadRun` / `findRunByProjectBranch` — read a run plus attempt history; the latter resolves the `(project, branch, stepId)` resume key (stepId optional for single-step) to the most recent run.
- `recordAttemptStart` — insert an `in-progress` attempt row.
- `commitCompletionBoundary` — the one transactional write: attempt completion, outcome classification, and run checkpoint (`attempt_count` + status) commit or roll back together. Idempotent: re-committing a finished boundary is a no-op, so recovery can never double-advance the checkpoint or duplicate an outcome.
- `setRunStatus` — status update outside a boundary. Current use: marking `budget-soft-stopped` when an invocation exits on budget after its last committed `progress` boundary.
- `commitGuardedKill` — set `killed` unless the row is already boundary-terminal (`completed`, `blocked`, `failed`); `paused` is not boundary-terminal. Used by daemon `kill`.
- `beginRunReconciliation` / `finishRunReconciliation` — restart sweep: mark orphan runs whose owner is gone as `killed` + `reconciliation_pending`, except a durable `review-debate` row becomes terminal `interrupted`; return pending run ids, then clear pending after the owed `run_reconciled` event is persisted.
- `createPipeline` — admit an already-validated `PipelineDefinition` and optional `PipelineContext`: one `pipelines` row (`owner_identity` stamped with the calling process's identity, `status = 'active'`) plus one `pending` `pipeline_stages` row per authored stage, atomically (all-or-nothing; a mid-admission fault rolls back the pipeline and every stage). JSON serialization creates immutable admission snapshots. Returns the generated pipeline ID.
- `loadPipeline` — read an admitted pipeline, nullable context, and stages ordered by stored `position` (not insertion order); null when unknown. Legacy rows return `context = null`; the repository never synthesizes it from workflow rows or current caller state.
- `updateStage` — apply a targeted lifecycle patch (`StageLifecyclePatch`: optional `status`, `workflowInvocationId`, `startedAt`, `endedAt`, `artifact`, `failureDetail`) to one stage row in place. Omitted fields, and fields explicitly passed as `undefined`, are unchanged; an explicit `null` clears a nullable field. `artifact`/`failureDetail` round-trip losslessly only for JSON-representable values (no `undefined`, functions, or cyclic structures). Rejects a patch with no defined fields and an unknown `(pipelineId, stageId)`. Modifies only the targeted row — the row's `id`, `pipelineId`, `stageId`, and `position` and every sibling stage are untouched.
- `markApprovalAwaiting` — conditionally changes one `pending` approval row to `awaiting`.
- `decideApproval` — conditionally changes one `awaiting` approval row to `approved` or `rejected`. The status predicate is part of the write, so concurrent store handles admit exactly one decision.
- `reopenFailedPipeline` — atomically reopens a valid failed-plus-skipped-suffix pipeline in place: exactly one `failed` row, only `succeeded` predecessors, a contiguous `skipped` suffix immediately after the failure, and only `pending` rows beyond that suffix. The failed row and its skipped suffix become `pending`, clearing only their prior-attempt `workflow_invocation_id`, timestamps, `artifact`, and `failure_detail`; durable row IDs and authored `stageId` values are preserved on every row. Returns the failed continuation row's durable `PipelineStageRecord.id` (not its authored `stageId`) on application. Refusals (`pipeline-not-found`, `no-failure`, `multiple-failures`, `malformed-suffix`, `reopen-refused`) write nothing.
- `reconcilePipelines` (async) — restart sweep for pipelines, mirroring `beginRunReconciliation`'s ownership/liveness predicate but scoped to `pipelines.status = 'active'` rows: a pipeline is a settlement candidate only when `owner_identity` is `NULL` or names a different process no longer alive (`isOwnerAlive`). A pipeline owned by the sweeping process, or by any other live process, is untouched. Settlement — one transaction per sweep — sets the pipeline `status = 'interrupted'` and marks each of its stages currently outside `pending`/`succeeded`/`failed`/`interrupted`/`awaiting`/`approved`/`rejected`/`skipped` (i.e. active) `interrupted` with `ended_at` set; every `pending`, terminal, decided approval, or blocked-suffix (`skipped`) row is left as-is. Idempotent: the `status = 'active'` scan excludes already-`interrupted` pipelines, so a re-sweep changes nothing and does not re-return their IDs. Returns the settled pipeline IDs. No pipeline log stream or pending-flag column exists yet (unlike `beginRunReconciliation`'s `run_reconciled`/`reconciliation_pending`) — deferred until a consumer needs one.

Approval operations address `PipelineStageRecord.id`, while also requiring the separately authored `stageId` to match. Both identities survive reopen unchanged. Approval vocabulary is `pending` (not yet reached), `awaiting` (operator decision required), `approved`, and `rejected`. The operations refuse workflow rows and never use pipeline-wide approval flags.

Every approval operation returns the addressed `stageRecordId` plus `outcome: "applied" | "refused"`. Applied outcomes carry the persisted status and `marked-awaiting` or `decision-recorded`; refusals carry `stage-not-found`, `stage-id-mismatch`, `stage-not-approval`, `stage-not-pending`, `stage-not-awaiting`, or `invalid-decision`. A refusal writes nothing. Duplicate and losing-race requests therefore report `stage-not-pending` or `stage-not-awaiting` rather than silently succeeding or overwriting the winner.

`reopenFailedPipeline` uses the same applied/refused contract. A losing concurrent reopen reports `reopen-refused` rather than silently succeeding or overwriting the winner. Succeeded predecessor rows retain their durable ID, authored `stageId`, workflow invocation ID, and artifact unchanged.

The current `artifact` envelope (written by `v2/src/daemon/pipeline-stage-dispatch.ts`) is pointer-only: `{ entryRunId, invocationId?, specPath, prNumber?, prUrl? }`, never artifact file content — this layer stores it opaquely and does not interpret the shape or the `status`/`failureDetail` vocabulary; that interpretation lives in `daemon-host.md`.

`failureDetail` on `pipeline_stages` rows is JSON-opaque to the store; writers today use one of:

- `{ message: string }` — resolution failures, unexpected throws, and missing entry-run spec paths at settlement.
- `{ code: string, message: string }` — dispatch-time refusals (`worktree_claimed`, etc.).
- `{ reason, retryable, nextAction }` — composed operator errors from `composeRunOperatorError` when the entry run row is missing at settlement.
- The full operator-error object from `composeRunOperatorError` when the entry run row is present.

The pipeline-level `status` stores only restart-reconciliation state:
`active` or `interrupted`. It does not describe execution progress. Callers
derive overall pipeline state from stage rows with
`derivePipelineState`, one of five states:

- `succeeded` — every authored stage in order has passed (workflow rows read `succeeded`; approval rows read `approved`); no undispatched gate remains.
- `failed` — any workflow stage row reads `failed`, or any approval row reads `rejected`.
- `awaiting-approval` — every stage up to (not including) the next-in-order
  approval stage has passed, and that approval row reads `awaiting`.
- `running` — some workflow stage row reads `running`.
- `pending` — admitted, but the loop has not yet reached a dispatchable
  stage.

`skipped` rows (written when an earlier stage fails) are never themselves
read as `failed` — they only distinguish "will never run" from "not yet
reached". See `daemon-host.md`'s "Ordered pipeline progression" for how the
loop drives stages into these rows.

## Semantics

- A run's durable `status` must agree with its terminal log signal; harness guesses (`killed`, reconcile) never overwrite a boundary-terminal status committed by `commitCompletionBoundary`. A terminal `loop_finished` row must not combine `runStatus: "completed"` with `resumable: true`; surviving-mutation failures settle `failed` with `resumable: true` and matching operator `error` fields.

- Outcomes are deterministic classifications, not free-form payloads; the runner branches on them. No transcripts or cost streams — the store carries only what resume reads. Token/cost and per-invocation usage belong in the telemetry JSONL substrate, not here — see [`telemetry-capture.md`](telemetry-capture.md).
- Recovery derives from durable state only: the `(project, branch, stepId)` lookup, run status, and attempt/outcome history. A durable review-debate row has one attempt spanning its fixed cycles and roles; a restart stores `interrupted` without mid-cycle replay. `budget-soft-stopped` resumes with a fresh per-invocation budget; a terminal run status returns its stored result idempotently.
- Multi-step workflows use `stepId` to isolate per-step attempt history: each
  workflow step maintains its own durable `(project, branch, stepId)` run,
  allowing independent resume tracking, run ids, and attempt counts. In one
  successful two-step run, step one and step two keep separate attempt
  histories even if they complete in different numbers of attempts.
- Workflow-backed step runs also share one durable `workflow_snapshot`, so a daemon `list` row can render the authored step order, `stepId`, and `role` for not-yet-started and already-finished steps without scanning unrelated runs.
- `beginRunReconciliation` (async) scopes reconciliation to a run's admitting process, not merely its status: a non-terminal row is a kill candidate only when `owner_identity` is `NULL` or names a different process that is no longer alive (`isOwnerAlive`, an injectable `(identity) => Promise<boolean>` — alive iff the pid exists and its `ps -o lstart=`-derived start epoch matches the recorded one; an existing pid with an unreadable epoch counts as alive). A row owned by the sweeping process itself, or by any other live process, is never touched. `openStateStore(path?, { currentIdentity?, isOwnerAlive? })` overrides let tests simulate a prior incarnation and inject liveness.

See `v2-architecture.md` (**Runs & state**, **Persistence**, **Recovery**) for the broader design.
