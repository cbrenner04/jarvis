# State store

Durable state for v2 runs and execution history: SQLite at `~/.jarvis/state/v2.sqlite`.

`openStateStore(path?)` creates or opens the file and bootstraps the schema idempotently before any operation; tests pass a path override and write nothing under `~/.jarvis`. Schema changes are forward-only: append migration statements when the first incompatible change lands — never ahead of consumers.

## Schema

- `runs` — orchestration identity, lifecycle, and checkpoint: `id`, `project`, `spec_ref`, `created_at`, `status` (`in-progress` | `completed` | `blocked` | `budget-soft-stopped` | `failed`), `attempt_count` (durable resume checkpoint), `worktree_path` (reconstructible pointer), `branch` (durable), `spec_path`, `step_id` (nullable, opaque workflow step identifier for multi-step resume tracking), and nullable `workflow_snapshot` JSON (`{ invocationId, steps: [{ stepId, role }] }`) for workflow-backed runs.
- `attempts` — one row per step attempt: `id`, `run_id`, `attempt_number`, `started_at`, `status` (`in-progress` | `completed`), plus the durable outcome once committed: `outcome_kind` (`done` | `no-work` | `progress` | `blocked` | `contract_miss` | `invocation_failure` | `invalid_token`), `completed_at`, and nullable `invocation_failure_detail` JSON (`{ failureKind, bindingAttempts }`) on terminal binding-chain `invocation_failure` only.

Forward-only migrations:
- `004-invocation-failure-detail` adds `invocation_failure_detail`. Legacy `invocation_failure` rows with null detail omit `failureKind` and `bindingAttempts` on load and idempotent re-entry — no migrate-on-read synthesis.
- `005-run-step-id` adds `step_id` (nullable). Resume key extends from `(project, branch)` to `(project, branch, step_id)`: `step_id` omitted (NULL) yields single-step behavior matching pre-migration runs.
- `006-run-workflow-snapshot` adds `workflow_snapshot` (nullable). Workflow-backed step runs persist authored workflow metadata so daemon/TUI consumers can render pending, active, and completed steps after quiescence.
- `007-run-queued-input` adds `queued_input` (nullable), the persisted `WriteLoopInput` for a run admitted `queued` (memory headroom unavailable at admission).
- `008-attempt-completion-agent` adds `completion_agent` on `attempts`.
- `009-run-creation-title` adds `creation_title` (nullable) on `runs`.
- `010-run-reconciliation-pending` adds `reconciliation_pending` (default `0`) on `runs`, tracking a `run_reconciled` event still owed after a reconciliation kill.
- `011-run-owner-identity` adds `owner_identity` (nullable) on `runs`: `<pid>:<process-start-epoch>` of the process that admitted the row, stamped by `createRun`. No backfill — pre-migration rows read back `NULL`. Not exposed on the `Run` type or `RUN_COLUMNS`; read only internally by reconciliation. See [`daemon-host.md`](daemon-host.md#restart-reconciliation) for the reconciliation predicate this backs.

## API

Repository-style named ops keyed by durable IDs — no public SQL surface. Signatures: the `StateStore` interface in [`state-store.ts`](../src/persistence/state-store.ts).

- `createRun` — insert a run (`in-progress`, zero attempts); accepts optional `stepId` and optional `workflowSnapshot` for workflow-backed runs; returns its ID.
- `loadRun` / `findRunByProjectBranch` — read a run plus attempt history; the latter resolves the `(project, branch, stepId)` resume key (stepId optional for single-step) to the most recent run.
- `recordAttemptStart` — insert an `in-progress` attempt row.
- `commitCompletionBoundary` — the one transactional write: attempt completion, outcome classification, and run checkpoint (`attempt_count` + status) commit or roll back together. Idempotent: re-committing a finished boundary is a no-op, so recovery can never double-advance the checkpoint or duplicate an outcome.
- `setRunStatus` — status update outside a boundary. Current use: marking `budget-soft-stopped` when an invocation exits on budget after its last committed `progress` boundary.

## Semantics

- Outcomes are deterministic classifications, not free-form payloads; the runner branches on them. No transcripts or cost streams — the store carries only what resume reads. Token/cost and per-invocation usage belong in the telemetry JSONL substrate, not here — see [`telemetry-capture.md`](telemetry-capture.md).
- Recovery derives from durable state only: the `(project, branch, stepId)` lookup, run status, and attempt/outcome history. An attempt still `in-progress` is the interrupted-state read ("re-run that dirty iteration"); `interrupted` is never stored. `budget-soft-stopped` resumes with a fresh per-invocation budget; a terminal run status returns its stored result idempotently.
- Multi-step workflows use `stepId` to isolate per-step attempt history: each
  workflow step maintains its own durable `(project, branch, stepId)` run,
  allowing independent resume tracking, run ids, and attempt counts. In one
  successful two-step run, step one and step two keep separate attempt
  histories even if they complete in different numbers of attempts.
- Workflow-backed step runs also share one durable `workflow_snapshot`, so a daemon `list` row can render the authored step order, `stepId`, and `role` for not-yet-started and already-finished steps without scanning unrelated runs.
- `beginRunReconciliation` (async) scopes reconciliation to a run's admitting process, not merely its status: a non-terminal row is a kill candidate only when `owner_identity` is `NULL` or names a different process that is no longer alive (`isOwnerAlive`, an injectable `(identity) => Promise<boolean>` — alive iff the pid exists and its `ps -o lstart=`-derived start epoch matches the recorded one; an existing pid with an unreadable epoch counts as alive). A row owned by the sweeping process itself, or by any other live process, is never touched. `openStateStore(path?, { currentIdentity?, isOwnerAlive? })` overrides let tests simulate a prior incarnation and inject liveness.

See `v2-architecture.md` (**Runs, state & the human loop**, **Persistence**, **Recovery**) for the broader design.
