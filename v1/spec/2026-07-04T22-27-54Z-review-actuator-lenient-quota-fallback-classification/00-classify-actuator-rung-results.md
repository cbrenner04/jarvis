# Classify actuator rung results through applyQuotaFallbackWhenAllowed

## Problem

The review actuator loop in `createActuator` (`v1/src/modes/patch/review.ts`)
branches on `agent.run()`'s raw result `kind`. With `quotaFallback: "lenient"`
and a matching `weakQuotaExitCodes` entry, a rung that exits with an `error`
result is treated as terminal and thrown, instead of being upgraded to
`quota` and falling through to the next `reviewActuatorOrder` entry — unlike
every other per-agent fallback loop in the codebase.

## Decisions

- Call `applyQuotaFallbackWhenAllowed(resolvedAgent.name, result, { quotaFallback, weakQuotaExitCodes }, true)` once per rung, right after `resolvedAgent.run()` returns and before the `result.kind === "ok"` check — always-allowed (`true`), matching `v1/src/modes/patch/shrink.ts`.
- Rename the classified value `classified`; keep the raw `run()` return as `result`. Reads split as:
  - Classified (`classified.kind`): the `"ok"` success gate; `isIdleTimeout`/`isQuota` computation; the final exit-code, telemetry `kind`, and `exitReason` computation; the terminal-throw message; the `review: actuator error (${...})` log line; the `result.kind !== "quota" && result.stderr...` raw-stderr fanout gate (so a lenient-upgraded rung logs `error (quota)` and skips the raw-stderr dump).
  - Raw (`result`): only the quota fanout-line selection, kept three-way — native-quota+`authFailure` → auth-rotate line; native-quota (no `authFailure`) → strict-quota line; `result.kind === "error"` with `classified.kind === "quota"` → lenient-fallback line via `harnessQuotaFallbackLenientLine(result.exitCode)` — mirroring `shrink.ts`'s exact branch.
- Branch order per rung: check the quota branch (`isQuota`, both the `hasNextRung` fallback and the final-rung terminal case) before ever evaluating `isIdleTimeout`, matching `shrink.ts`'s quota-first ordering. Today the actuator checks idle-timeout first; this reorders the two branches without changing either branch's own internal logic.
- Final-rung quota (native or lenient-upgraded, `isQuota && !hasNextRung`): no new terminal branch — it falls into the existing generic exit-code/telemetry/throw path, which already yields `exitCode: 1`, telemetry `kind: "quota"`/`exitReason: "quota"`, and throw message `actuator failed: quota` for native quota today; classification puts the lenient case on the identical path. This intentionally diverges from `shrink.ts`'s dedicated "all agents quota-exhausted (discarded)" revert-and-return branch, since the actuator has no analogous discard step here and none is being added.

## Out of scope

- Rewriting the rung loop onto `executeWithQuotaFallback` / `createReviewInvocationBinding`.
- The already-fixed strict-quota fallback branch and idle-timeout fallback branch (internal logic unchanged; only their relative check order moves).

## Task checklist

- [ ] Import `applyQuotaFallbackWhenAllowed` in `v1/src/modes/patch/review.ts`.
- [ ] Classify each rung's result once, before the `result.kind === "ok"` branch.
- [ ] Switch the enumerated classified-kind reads (success gate, `isIdleTimeout`/`isQuota`, exit-code/telemetry/exitReason, terminal-throw message, error-log line, raw-stderr fanout gate) to `classified.kind`; keep only the quota fanout-line three-way selection on raw `result`.
- [ ] Reorder branches so quota (`hasNextRung` fallback and final-rung terminal) is checked before `isIdleTimeout`.
- [ ] Add a regression test: lenient `quotaFallback` config + a `weakQuotaExitCodes` match on a non-final rung falls through to the next `reviewActuatorOrder` agent instead of throwing.
- [ ] Add a regression test: the same lenient match on the *final* rung throws `ReviewTerminalError` with the existing quota-exhausted exit code/message (exit code 1, `actuator failed: quota`), not a generic error-shaped throw.

## Acceptance criteria

- [x] With `quotaFallback: "lenient"` and an exit code in `weakQuotaExitCodes`, a non-final actuator rung's `error` result falls through to the next configured `reviewActuatorOrder` agent instead of terminating the review pass.
- [x] The same lenient match on the final configured rung terminates the review pass with the existing quota-exhausted terminal error (exit code 1, `actuator failed: quota`), matching today's native-quota final-rung behavior.
- [x] Existing strict-quota (including auth-rotate) and idle-timeout actuator fallback behavior is unchanged.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- Update `v2/docs/v1-behaviors.md`: record that the review actuator now applies lenient weak-quota fallback classification per rung, consistent with other per-agent fallback loops.
