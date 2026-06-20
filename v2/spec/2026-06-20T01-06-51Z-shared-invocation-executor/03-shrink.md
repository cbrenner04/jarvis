# 03 - Shrink phase routes through executor

## Problem

`v1/src/modes/patch/shrink.ts` `runPatchShrinkPhase` carries the fourth copy of the fallback loop: a single shrink invocation looped over `modes.patch.agentOrder` with strict-quota and lenient probable-quota rotation, per-rotation `shrink:` stderr, `patch_phase: "shrink"` telemetry, and discard-on-exhaustion. It must route through the shared executor and 00 binding while keeping the shrink contract (pre-shrink gate, out-of-scope revert, AC-regression/deleted-test/test-failure checks, discard-vs-commit).

## Decisions

- Only the agent spawn + quota rotation moves to `executeWithQuotaFallback` + the 00 binding; the shrink contract (gating, scope revert, contract validation, commit/discard) stays in `shrink.ts`. Rules out folding shrink's post-invocation validation into the shared loop.
- Shrink uses the lenient guard `allowLenientWeakQuotaFallback = true` (no porcelain/progress gate) as today. Rules out reusing plan's porcelain-unchanged guard for shrink.
- Exhaustion still reverts to `preShrinkHead` and returns without elevating the run exit code; per-rotation and exhaustion stderr lines unchanged. Rules out surfacing shrink quota exhaustion as a run failure.

## Acceptance criteria

- [ ] Quota exhaustion across all patch agents during shrink discards changes (reset to pre-shrink HEAD) and returns without elevating the run exit code, with the existing `shrink: all agents quota-exhausted (discarded)` line.
- [ ] A single agent's strict-quota or lenient probable-quota result rotates to the next configured patch agent and emits the existing `shrink:` fallback stderr line for each case.
- [ ] On success the shrink contract is unchanged: out-of-scope/spec-tree revert, AC-regression / deleted-scoped-test / failing-test discard, and the single attributed `shrink:` commit on pass.
- [ ] `patch_phase: "shrink"` telemetry rows (kind, exitReason) are unchanged across ok/quota-fallback/quota-exhausted/error.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

Internal routing refactor only; shrink contract, messages, and telemetry unchanged. No doc update required (architecture note consolidated in 00 and 04).
