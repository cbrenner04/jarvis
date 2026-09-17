# Stale-owner settlement guard

## Problem

`commitTerminalRunSettlement` in `v2/src/persistence/state-store.ts` overwrites status unconditionally, so a non-owner daemon silently replaces a terminal status another generation wrote.

## Decisions

- Only `commitTerminalRunSettlement` is guarded. `commitGuardedKill` is excluded: it already no-ops on any row whose status is `isBoundaryTerminalRunStatus`, regardless of identity, so an identity guard there is redundant. `setRunStatus` is excluded: none of its callers write a terminal `RunStatus` (they pass `"in-progress"`, `"paused"`, or `"budget-soft-stopped"`), so it never performs a settlement this guard concerns. Rules out redundant re-guarding of `commitGuardedKill` and rules out expanding scope to `setRunStatus`'s ~18 callers.
- The guard fires only when the row's *current* status is already terminal (`isTerminalRunStatus`) — a first-time terminal write always applies regardless of reporting identity. This is what lets `daemon-run-reconciliation.ts`'s `reconcileOrphanedRuns` keep working unmodified: it only calls `commitTerminalRunSettlement` when `!isTerminalRunStatus(run.status)`, i.e. on non-terminal rows, so it never hits the guard even though it settles a run whose stamped `owner_identity` is a confirmed-dead prior owner, not the reconciling identity. Rules out blocking legitimate first-time terminal writes from a non-owner.
- When the guard does fire (row already terminal), it compares the row's `owner_identity` against the store's current identity: `owner_identity IS NULL` always permits the settlement (an unstamped/legacy row has no owner to be stale relative to), `owner_identity = currentIdentity` permits it, and any other non-null value is dropped: status, `finished_at`, and settlement evidence stay unchanged. Rules out a legacy row with `owner_identity IS NULL` silently dropping every settlement.
- `commitTerminalRunSettlement` returns `RunSettlementOutcome = { kind: "applied" } | { kind: "rejected"; attemptedStatus: RunStatus; reportingIdentity: string }` instead of `void`. Rules out the state store writing the log store directly (the log store is separate from the state store).
- `write-loop.ts`'s `settleCompletedPublication` (the completion-settlement helper used by all six of its own call sites) is the one caller wired to check the outcome in this subspec: on `rejected`, it appends a `run_settlement_rejected` log entry — `{ kind: "run_settlement_rejected", attemptedStatus, reportingIdentity }` — via the caller's already-in-scope `logSink`. Pins the event name and fields rather than deferring them, since this subspec's own acceptance criteria are already the first consumer. Other `commitTerminalRunSettlement` callers (`daemon.ts`, `run-time-budget.ts`, `daemon-run-lifecycle-handlers.ts`, `daemon-workflow-admission-handlers.ts`, `workflow-runner.ts`) keep ignoring the new return value in this subspec — the row-level guard protects them regardless of whether they log the rejection, so leaving them unwired is a scope choice, not a gap in the guard.

## Acceptance criteria

- [x] A test in `v2/src/persistence/state-store.test.ts` asserts a non-owner settlement on an already-terminal row is rejected — status, `finished_at`, and evidence stay unchanged, and the call returns `{ kind: "rejected", attemptedStatus, reportingIdentity }`; it fails against the pre-fix unconditional overwrite.
- [x] A test in `v2/src/persistence/state-store.test.ts` asserts settlement applies when the row's `owner_identity` is null, equals the reporting identity, or when the row is not yet terminal (even from a non-owner identity), pinning that legacy rows and reconciliation-style non-terminal writes are unaffected.
- [x] A test covering `settleCompletedPublication` in `v2/src/execution/write-loop.test.ts` (or its equivalent split file) asserts a `rejected` outcome appends a `run_settlement_rejected` log entry naming `attemptedStatus` and `reportingIdentity`; it fails against the pre-fix code, which does not check the return value.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Daemon retirement on supersession — a terminal settlement from a non-owner identity onto an already-terminal row is dropped (null-owner and non-terminal-row writes still apply); `settleCompletedPublication` logs the rejection as `run_settlement_rejected`.
- `v2/docs/v1-behaviors.md` — record the new baseline replacing silent stale-owner overwrite.
