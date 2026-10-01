---
name: agent-full-suite-runs-capped-per-iteration
---

# Agent full-suite gate runs are capped per write iteration

## Problem

Implement agents rerun `bun run test:v2` dozens of times in one write iteration until `iteration_timeout`. Each run takes minutes under load and some tests false-red in the agent sandbox, so the agent loops. The gate slot caps only *concurrent* agent gates, not how many one iteration runs back to back. Prompt guidance alone has not stopped it.

## Evidence

- 2026-10-01, cursor (Composer 2.5) implement lanes, `bun run test:v2` count per session log: cb00816d 27×, 7194c5ef 35×, 476caf84 33×, fc54822c ~26×, 39e973dc 43× (plus `test:integration:v2`, `test:confirm:live`); each ended at the 45-min `iteration_timeout`.
- Doc fixes did not help: AGENTS.md says iterate with `bun test <file>` and run surface scripts once (#4370) and that integration slices are harness-run (#4374); 39e973dc started after both.
- Classification: `isReadyTestCommand` matches `^bun run test(:|$)` (`v2/src/execution/ready-finalize.ts:340-342`); `bun test <file>` does not match.
- Per-iteration tracker `createIterationActiveGateTracker` (`v2/src/execution/write-loop.ts:736-772`), built once per iteration (`write-loop.ts:2670-2679`), fed by claude/cursor NDJSON shell-tool events (`write-loop.ts:3200-3215`). It refuses only on `ceiling_headroom` (`:755-757`) or `slot_contention` (`:759-762`, `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS = 1` at `:685`); `onAgentShellCommandComplete` releases the lease (`:766-770`), so serial reruns are each admitted.
- A refusal aborts the invocation (`:2675-2678`) and `finishGateInvocationRefused` settles the run terminal `failed` resumable (`:2841-2901`); slot re-drive handles only `slot_contention` (`v2/src/daemon/daemon-slot-redrive.ts:46-47`).

## Decisions

- Add `MAX_AGENT_GATE_INVOCATIONS_PER_ITERATION = 2`. The tracker counts admitted classified invocations; the next one past the budget is refused with new cause `iteration_gate_budget`, checked before headroom and slot. Classification stays `isReadyTestCommand`; rules out narrowing it (the count, not the command set, is the defect).
- `iteration_gate_budget` aborts the iteration like other refusals but is not terminal: settled work checkpoints through `checkpointBeforeControlledLoss`, the iteration counts toward `maxIterations`, and the loop continues with a next-iteration reprompt (`prompts/write/gate-budget-reprompt.md`, registered in `prompts/registry.txt`, same seam as `stagedMarkdownLintReprompt`) naming the refused command and telling the agent to verify with `bun test <file>` and finish, the harness ready gate being the final full-suite run. Rules out a terminal `gate_invocation_refused` settlement and slot re-drive for this cause.
- Log `gate_invocation_budget_refused` with `command` and `admittedCount` in `jarvis run log`.
- The budget counter lives in the write-loop tracker, not the lease; coordinates with `finalization-ready-gates-share-the-gate-slot` moving the lease to `gate-invocation-lease.ts` (whichever lands second rebases onto it). Harness finalization gates are not counted.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop-gate-budget.test.ts` proves a stubbed cursor iteration emitting three serial `bun run test:v2` shell commands is refused on the third with cause `iteration_gate_budget`, and that interleaved `bun test <file>` commands are not counted; fails against main, where all three are admitted.
- [ ] Same file proves the refused iteration checkpoints settled edits and the next iteration's prompt contains the gate-budget reprompt naming the refused command and `bun test <file>`; the run is not settled `gate_invocation_refused`; fails against main.
- [ ] Same file proves the budget resets per iteration (two admitted invocations in iteration 2 after a budget refusal in iteration 1).
- [ ] `v2/src/daemon/daemon-slot-redrive.test.ts` proves an `iteration_gate_budget` cause is never re-drive eligible.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Concurrency — per-iteration budget and `iteration_gate_budget` cause.
- `v2/docs/write-behavior.md` — gate-budget refusal and reprompt.
- `prompts/implement/rules.md` — state the budget so the agent knows it up front.
