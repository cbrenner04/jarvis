# 03 - Shrink phase routes through executor

## Problem

`v1/src/modes/patch/shrink.ts` `runPatchShrinkPhase` carries the fourth copy of the fallback loop: a single shrink invocation looped over `modes.patch.agentOrder` with strict-quota and lenient probable-quota rotation, per-rotation stderr (the `${agent.name}:` prefix plus a `result.stderr` passthrough — *not* a `shrink:` prefix), `patch_phase: "shrink"` telemetry, and discard-on-exhaustion. Only contract/exhaustion lines (e.g. `shrink: all agents quota-exhausted (discarded)`) carry the `shrink:` prefix. It must route through the shared executor and 00 binding while keeping the shrink contract (pre-shrink gate, out-of-scope revert, AC-regression/deleted-test/test-failure checks, discard-vs-commit).

## Decisions

- Only the agent spawn + quota rotation moves to `executeWithQuotaFallback` + the 00 binding; the shrink contract (gating, scope revert, contract validation, commit/discard) stays in `shrink.ts`. Rules out folding shrink's post-invocation validation into the shared loop.
- Shrink uses the lenient guard `allowLenientWeakQuotaFallback = true` (no porcelain/progress gate) as today, supplied via the 00 classification guard thunk. Rules out reusing plan's porcelain-unchanged guard for shrink.
- Shrink supplies the `${agent.name}:` + `result.stderr` rotation emitter through the 00 factory; the `shrink:` prefix is reserved for contract/exhaustion lines emitted by `shrink.ts`, not by the rotation. Rules out routing rotation stderr through a `shrink:`-prefixed emitter and regressing the byte-identical output.
- Exhaustion still reverts to `preShrinkHead` and returns without elevating the run exit code; per-rotation and exhaustion stderr lines unchanged. Rules out surfacing shrink quota exhaustion as a run failure.

## Acceptance criteria

- [x] Quota exhaustion across all patch agents during shrink discards changes (reset to pre-shrink HEAD) and returns without elevating the run exit code, with the existing `shrink: all agents quota-exhausted (discarded)` line.
- [x] A single agent's strict-quota or lenient probable-quota result rotates to the next configured patch agent and emits the existing rotation stderr (`${agent.name}:` prefix + `result.stderr` passthrough) byte-identically for each case.
- [x] On success the shrink contract is unchanged: out-of-scope/spec-tree revert, AC-regression / deleted-scoped-test / failing-test discard, and the single attributed `shrink:` commit on pass.
- [x] `patch_phase: "shrink"` telemetry rows (kind, exitReason) are unchanged across ok/quota-fallback/quota-exhausted/error.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

Internal routing refactor only; shrink contract, messages, and telemetry unchanged. No doc update required (architecture note consolidated in 00 and 04).
