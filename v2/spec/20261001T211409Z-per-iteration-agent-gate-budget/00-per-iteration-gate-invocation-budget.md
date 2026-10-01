# Per-iteration gate invocation budget

## Problem

`createIterationActiveGateTracker` admits every serial `bun run test:*` gate invocation after the prior lease releases; only concurrent slot contention and ceiling headroom refuse. Implement agents loop dozens of full-suite runs per write iteration until `iteration_timeout`.

## Decisions

- `MAX_AGENT_GATE_INVOCATIONS_PER_ITERATION = 2`; the tracker counts admitted starts for commands classified by `isReadyTestCommand` (`^bun run test(:|$)`); the next classified start is refused with cause `iteration_gate_budget` before headroom and slot checks; rules out refusing only after headroom/slot or counting `bun test <file>`.
- The budget counter lives in the per-iteration tracker (new tracker instance each iteration); rules out lease-global or run-global counting and rules out counting harness finalization ready-gate subprocesses.
- Extend in-process `GateInvocationRefusalCause` with `iteration_gate_budget`; do not add it to durable `GateRefusalRecoveryCause`; rules out `gate_refusal_recovery_state` rows and slot re-drive for this cause (reachable today: `slotRedriveWaiting` in `v2/src/daemon/daemon-slot-redrive.ts` accepts only `slot_contention`).
- Budget refusal aborts the active invocation like other gate refusals but is not terminal: after quiescence, checkpoint settled edits via `checkpointBeforeControlledLoss`, consume the iteration toward `maxIterations`, continue the write loop with a next-iteration reprompt from `prompts/write/gate-budget-reprompt.md` (registered in `prompts/registry.txt`, wired like `stagedMarkdownLintReprompt`) naming the refused command and directing file-scoped `bun test <file>` verification; rules out `finishGateInvocationRefused`, terminal `gate_invocation_refused` settlement, and slot re-drive for this cause.
- On budget refusal append run log event `gate_invocation_budget_refused` with `command` and `admittedCount` (count of admitted classified invocations in that iteration before the refusal).

## Tasks

- Add `MAX_AGENT_GATE_INVOCATIONS_PER_ITERATION` and admitted-count logic to `createIterationActiveGateTracker` in `v2/src/execution/write-loop.ts`.
- Branch the write loop so `iteration_gate_budget` quiesces, logs `gate_invocation_budget_refused`, checkpoints when quiesced settled, and carries a gate-budget reprompt into the next iteration without `finishGateInvocationRefused`.
- Add `prompts/write/gate-budget-reprompt.md`, register it in `prompts/registry.txt`, and thread reprompt context through `write-loop.ts` / `write.ts` on the same seam as staged Markdown lint reprompt.
- Add `v2/src/execution/write-loop-gate-budget.test.ts`.
- Extend `v2/src/daemon/daemon-slot-redrive.test.ts` `slotRedriveWaiting` pin with a synthetic row whose `gateRefusalRecoveryState.cause` is `iteration_gate_budget` (cast, same reachability as the existing `ceiling_headroom` pin).

## Acceptance criteria

- [ ] `v2/src/execution/write-loop-gate-budget.test.ts` proves a stubbed cursor iteration emitting three serial `bun run test:v2` shell commands refuses the third with cause `iteration_gate_budget` and does not count interleaved `bun test <file>` commands; it fails against main where all three are admitted.
- [ ] The same file proves the refused iteration checkpoints settled edits and the next iteration prompt contains the gate-budget reprompt naming the refused command and `bun test <file>`; the run is not settled `gate_invocation_refused`; it fails against main.
- [ ] The same file asserts run log `gate_invocation_budget_refused` with the refused `command` and `admittedCount` on the third refusal; it fails against main.
- [ ] The same file proves the budget resets per iteration (two admitted invocations in iteration 2 after a budget refusal in iteration 1); it fails against main.
- [ ] `v2/src/daemon/daemon-slot-redrive.test.ts` `slotRedriveWaiting` pin extended with a synthetic failed row whose `gateRefusalRecoveryState.cause` is `iteration_gate_budget` (cast, same reachability as the existing `ceiling_headroom` pin); never redrive-eligible — fails if redrive eligibility broadens beyond `slot_contention`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None in this subspec (see [01-operator-docs-and-implement-rules.md](./01-operator-docs-and-implement-rules.md)).
