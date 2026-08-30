# Write-loop terminal settlement

Authoritative for write-loop terminal settlement: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`write-loop.ts` and `successor-step-idle-watchdog.ts` still hand-order terminal `runs.status`, `setPrEvidence`, `commitCompletionBoundary`, and `loop_finished` emission. Fresh and resumed completion publication calls `setPrEvidence` then `setRunStatus(..., "completed")` in separate commits (`write-loop.ts` ~906–910, ~1663–1667). Several failure paths call `commitCompletionBoundary` with a terminal `runStatus` and then call `setRunStatus` again (`write-loop.ts` ~1272–1283 landing_failed). `completionCommitFailed` writes `completed` without atomic cause or failure detail (`write-loop.ts` ~3311). No observer reading `loadRun` immediately after the first durable terminal write is guaranteed PR evidence, `terminalCause`, and `terminalFailureDetail` together.

## Decision ledger

- Terminal run-row commits in execution use `commitTerminalRunSettlement` or `commitCompletionBoundary` after persistence routes terminal `runStatus` through settlement inside the existing boundary transaction when optional settlement evidence is supplied on the boundary args; rules out direct `setRunStatus` terminal literals and hand-ordered `setPrEvidence` before terminal visibility.
- `terminalCause` on settled rows stores the durable `loopOutcomeKind` for that path; attempt `outcome_kind` stays the boundary classifier; rules out collapsing attempt outcome and operator-facing terminal cause into one column.
- Successful completion publication supplies confirmed `prNumber`/`prUrl` in the same settlement call that first exposes `completed`; rules out reverting to evidence-before-status as two store operations.
- Resumable failure settlements (`completion_commit_failed`, `ready_gate_failed`, `surviving_mutation_failed`, `iteration_timeout` with resumable inventory, successor-shell stall) carry matching `terminalFailureDetail` when the path already constructs `InvocationFailureDetail` or gate/mutation diagnostics; rules out leaving durable `failed` rows without the evidence `composeRunOperatorError` would need when logs are absent.
- Non-resumable terminal failures (`landing_failed` budget exhaustion, dirty `no-work`, non-resumable `iteration_timeout`, `ready_flip_failed`, `blocked`, `contract_miss`, and similar) still settle through the same primitive with the appropriate `terminalCause` and optional detail; rules out exempting “simple” failures from the migration.
- `budget-soft-stopped` stays a nonterminal `setRunStatus` write (resumable soft-stop, not `isTerminalRunStatus`); rules out routing it through terminal settlement.
- Finalization-repair and publication tails that temporarily hold `in-progress` still settle terminal status only after repair quiescence; rules out weakening the existing join-before-terminal contract from `v2/docs/write-behavior.md`.
- Structured `loop_finished` / `boundary_committed` logs remain lifecycle history appended after durable settlement; rules out making log append a prerequisite for terminal observation.

## Tasks

- Extend `commitCompletionBoundary` so terminal `runStatus` commits through `commitTerminalRunSettlement` inside the same transaction when optional `terminalCause`, `prNumber`/`prUrl`, and `terminalFailureDetail` are supplied; keep nonterminal boundaries unchanged.
- Inventory every production terminal transition in `write-loop.ts` and `successor-step-idle-watchdog.ts` (fresh and resumed publication tails, main-loop terminal boundaries, landing and plan-draft failures, ready/gate/mutation publication failures, `completionCommitFailed`, finalization-repair outcomes, iteration timeout, successor-shell stall) and route each through settlement with the correct status, cause, and evidence; leave nonterminal `budget-soft-stopped` promotion on `setRunStatus`.
- Remove redundant post-boundary `setRunStatus` terminal writes and standalone `setPrEvidence` calls that precede terminal visibility.
- Add or extend regressions that observe the store row immediately at the first durable terminal write; keep existing publication-ordering and resume tests green where behavior is preserved.
- Update the durable docs listed below.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` test `fresh completion publication persists PR evidence before the run becomes completed` is updated to assert the first durable `completed` observation through `loadRun` already carries `prNumber`, `prUrl`, `terminalCause: "complete"`, and `finishedAt`; it fails against the pre-fix split `setPrEvidence` / `setRunStatus` path reachable in `write-loop.ts` ~906–910.
- [ ] `v2/src/execution/write-loop.test.ts` test `resumed completion publication persists PR evidence before the run becomes completed and reuses the published PR` is updated with the same immediate atomic evidence assertion on the resume tail; it fails against the pre-fix block reachable in `write-loop.ts` ~1663–1667.
- [ ] `v2/src/execution/write-loop.test.ts` test `landing_failed budget exhaustion settles failed with terminal cause without a second status write` drives plan-draft landing budget exhaustion, proves the first durable `failed` row already carries `terminalCause: "landing_failed"` and no later `setRunStatus` is required; it fails against the pre-fix `commitCompletionBoundary` plus duplicate `setRunStatus` path reachable in `write-loop.ts` ~1272–1283.
- [ ] `v2/src/execution/write-loop.test.ts` test `ready_gate_failed settlement exposes atomic cause and failure detail before loop_finished` drives a gate failure through the publication tail, reloads the row before reading logs, and proves `status: "failed"`, `terminalCause: "ready_gate_failed"`, and matching `terminalFailureDetail`; it fails against the pre-fix `setRunStatus`-only failure tail.
- [ ] `v2/src/execution/successor-step-idle-watchdog.test.ts` test `successor shell stall settles invocation failure atomically` proves the first durable `failed` row carries `terminalCause: "invocation_failure"` and stall `terminalFailureDetail` before any `loop_finished` append; it fails against the pre-fix boundary-only write in `successor-step-idle-watchdog.ts` ~89–94.
- [ ] `v2/src/persistence/state-store.test.ts` test `commitCompletionBoundary routes terminal runStatus through settlement when evidence is supplied` fails against the pre-fix direct `UPDATE runs SET status` inside `commitCompletionBoundary` and proves `status`, `terminalCause`, and `prNumber`/`prUrl` are visible together after one boundary call.
- [ ] `v2/src/execution/write-loop.test.ts` — `fresh completion publication persists PR evidence before the run becomes completed`; Mutation checkpoint: `// @mutate v2/src/execution/write-loop.ts` restoring a standalone `setPrEvidence` before `setRunStatus(..., "completed")` on the fresh publication tail turns the test RED.
- [ ] `write-loop.test.ts` tests `completed-run resume replays publication after a prior publication failure`, `iteration_timeout with one completed subspec is resumable`, and `no-work over dirty worktree with publishCompletion false settles non-completed failure naming uncommitted paths` stay green (preserved non-terminal and failure semantics).
- [ ] `v2/docs/write-behavior.md` records write-loop terminal settlement through atomic store commits, immediate completed-row PR evidence, and durable `terminalCause` / `terminalFailureDetail` on failure tails covered in this slice.
- [ ] `v2/docs/v1-behaviors.md` records the write-loop terminal-settlement behavior change.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — write-loop completion, publication, repair, watchdog, and resume tails settle terminal run rows atomically with PR evidence and failure detail.
- `v2/docs/state-store.md` — `commitCompletionBoundary` terminal `runStatus` delegation to `commitTerminalRunSettlement` when settlement evidence is supplied.
- `v2/docs/v1-behaviors.md` — record write-loop atomic terminal settlement and immediate observer contract.
