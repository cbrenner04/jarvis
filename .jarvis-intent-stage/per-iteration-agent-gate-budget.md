---
name: per-iteration-agent-gate-budget
---

# Per-iteration cap on agent full-suite gate invocations

## Problem

`createIterationActiveGateTracker` admits every serial `bun run test:*` gate invocation after the prior lease releases; only concurrent slot contention and ceiling headroom refuse. Implement agents loop dozens of full-suite runs per write iteration until `iteration_timeout`.

## Decisions

- `MAX_AGENT_GATE_INVOCATIONS_PER_ITERATION = 2`; count admitted invocations classified by `isReadyTestCommand` (`^bun run test(:|$)`); refuse the next with cause `iteration_gate_budget` before headroom and slot checks; `bun test <file>` is not counted.
- Budget refusal aborts the active invocation like other refusals but is not terminal: checkpoint settled edits via `checkpointBeforeControlledLoss`, count the iteration toward `maxIterations`, continue with next-iteration reprompt from `prompts/write/gate-budget-reprompt.md` (registered in `prompts/registry.txt`, same seam as `stagedMarkdownLintReprompt`) naming the refused command and directing file-scoped `bun test <file>` verification; rules out `finishGateInvocationRefused` / `gate_invocation_refused` settlement and slot re-drive for this cause.
- Log `gate_invocation_budget_refused` with `command` and `admittedCount` on the run log.
- Counter lives in the per-iteration write-loop tracker, not the gate lease; harness finalization gates are not counted.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop-gate-budget.test.ts` proves a stubbed cursor iteration emitting three serial `bun run test:v2` shell commands refuses the third with cause `iteration_gate_budget` and does not count interleaved `bun test <file>` commands; fails against main where all three are admitted.
- [ ] Same file proves the refused iteration checkpoints settled edits and the next iteration prompt contains the gate-budget reprompt naming the refused command and `bun test <file>`; the run is not settled `gate_invocation_refused`; fails against main.
- [ ] Same file proves the budget resets per iteration (two admitted invocations in iteration 2 after a budget refusal in iteration 1).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Concurrency — per-iteration budget and `iteration_gate_budget` cause.
- `v2/docs/write-behavior.md` — gate-budget refusal and reprompt.
- `prompts/implement/rules.md` — state the budget up front.

## Primary implementation surface

v2/src/execution/write-loop.ts

## Prerequisites
