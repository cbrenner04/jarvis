# Recover reconciled runs after IPC opens

## Problem

Startup reconciles orphaned non-terminal runs to `killed` but leaves them for manual recovery, losing the interrupted iteration and obscuring which runs were affected.

## Decisions

- Recover the exact durable reconciliation result on every startup; rules out a pre-stop in-memory recovery list that misses crashes and forced stops.
- Open IPC before starting recovery admissions; rules out delaying daemon readiness until resumed work finishes.
- Reuse each run ID, workflow snapshot, worktree, and branch; rules out replacement runs that split history or abandon dirty work.
- Mark an automatic recovery admission failure `failed` and log its diagnostic; rules out leaving an attempted run ambiguously `killed` with only transient startup output.
- Attempt the remaining reconciled runs after one admission fails; rules out one malformed snapshot hiding or blocking the rest of the affected set.

## Work

- Return the runs actually reconciled from the startup sweep and admit each through the existing snapshot-backed write resume path after IPC opens.
- Persist a run-log outcome for every automatic recovery admission, including actionable failure detail.
- Cover restart ordering, successful recovery, independent failures, forced-stop orphans, and identity/worktree retention.
- Align durable daemon and operator documentation.

## Acceptance criteria

- [x] After IPC is listening, startup automatically attempts every run that its durable sweep reconciled from an orphaned non-terminal row, including a row orphaned by forced daemon stop.
- [x] IPC health remains available while automatically resumed work is still running.
- [x] A successful automatic recovery keeps the run ID, workflow snapshot, worktree, and branch, returns the run to live execution, and records the automatic resume in that run's durable log.
- [x] An automatic recovery admission failure records an actionable diagnostic in that run's durable log, leaves its durable status `failed`, and does not prevent attempts for the other reconciled runs.
- [x] `v2/src/daemon/daemon-reconciliation.test.ts` adds restart-recovery regression coverage that fails before this change and passes after it, including IPC-before-recovery ordering and success/failure observability.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` document automatic restart recovery, ordering, identity retention, and admission-failure semantics.

## Documentation updates

- Update `v2/docs/daemon-host.md` with restart ordering, recovery, and observability contracts.
- Replace manual restart-orphan recovery guidance in `v2/docs/operator-runbook.md` with automatic recovery and failure handling.
- Update the existing restart-reconciliation entry in `v2/docs/v1-behaviors.md`.
