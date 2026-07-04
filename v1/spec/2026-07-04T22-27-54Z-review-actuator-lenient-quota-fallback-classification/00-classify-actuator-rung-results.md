# Classify actuator rung results through applyQuotaFallbackWhenAllowed

## Problem

The review actuator loop in `createActuator` (`v1/src/modes/patch/review.ts`)
branches on `agent.run()`'s raw result `kind`. With `quotaFallback: "lenient"`
and a matching `weakQuotaExitCodes` entry, a rung that exits with an `error`
result is treated as terminal and thrown, instead of being upgraded to
`quota` and falling through to the next `reviewActuatorOrder` entry — unlike
every other per-agent fallback loop in the codebase.

## Decisions

- Call `applyQuotaFallbackWhenAllowed(headEntry.agent, result, { quotaFallback, weakQuotaExitCodes }, true)` on each rung's result before branching, matching `v1/src/modes/patch/shrink.ts` — always-allowed (`true`), since the actuator has no analogous "no progress" gate to condition on.
- Branch subsequent `isQuota` / `hasNextRung` / terminal-error logic on the classified result, not the raw `spawnResult`.
- Preserve raw-result details (stderr, exit code, `authFailure`) already used for fanout/telemetry lines by keeping a reference to the original `result` alongside the classified one.

## Out of scope

- Rewriting the rung loop onto `executeWithQuotaFallback` / `createReviewInvocationBinding`.
- The already-fixed strict-quota fallback branch and idle-timeout fallback branch.

## Task checklist

- [ ] Import `applyQuotaFallbackWhenAllowed` in `v1/src/modes/patch/review.ts`.
- [ ] Classify each rung's result before the `result.kind === "ok"` branch and the error-handling branches below it.
- [ ] Add a regression test: lenient `quotaFallback` config + a `weakQuotaExitCodes` match on a non-final rung falls through to the next `reviewActuatorOrder` agent instead of throwing.

## Acceptance criteria

- [ ] With `quotaFallback: "lenient"` and an exit code in `weakQuotaExitCodes`, an actuator rung's `error` result falls through to the next configured `reviewActuatorOrder` agent instead of terminating the review pass.
- [ ] Existing strict-quota and idle-timeout actuator fallback behavior is unchanged.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- Update `v2/docs/v1-behaviors.md`: record that the review actuator now applies lenient weak-quota fallback classification per rung, consistent with other per-agent fallback loops.
