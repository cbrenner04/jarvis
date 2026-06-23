# Per-project completion ready-gate retry bound

## Problem

The completion ready gate re-runs retryable red up to a fixed harness constant
(`COMPLETION_READY_GATE_RETRY_BOUND = 2`, 3 total attempts) before entering the
fix-up loop. Flaky target suites want a higher bound; stable suites want a lower
one (or 0, to fail fast into fix-up immediately). One hardcoded value can't
serve both.

Add a per-project config knob overriding that retry bound. Absent the knob, the
default (2) applies unchanged.

## Decisions

- Knob is a per-project field `readyGateRetryBound` — counts retries, not total attempts (total = bound + 1), matching the existing `COMPLETION_READY_GATE_RETRY_BOUND` constant. (Naming it "attempts" would invert the off-by-one against the constant and docs.)
- Validated as a non-negative integer; 0 is valid. (A positive-integer rule would forbid 0, but fail-fast-with-no-retry is an explicit goal.) Use the existing non-negative-integer config predicate so `Infinity`/`NaN` are rejected, not the looser `typeof === "number" && x >= 0`.
- No upper cap; an excessive bound is the operator's responsibility. (Capping would reintroduce a hardcoded ceiling the knob exists to escape.)
- The hardcoded constant becomes the default applied when the knob is absent; behavior is unchanged in that case.
- Resolve the override with `??` (nullish), not `||`: a configured `0` must win, and `||` would discard it back to the default — defeating the fail-fast goal. (`readyCommand` uses optional chaining, no local `??` precedent to copy.)
- Scope is the completion-transition gate only — the only site with a retry loop. Other ready-gate sites (pre-shrink, review baseline/final, `maybeMarkReady`) have no retry loop and the knob does not affect them.
- Knob name is deliberately unprefixed (not `completionReadyGateRetryBound`) because the completion gate is the only retry-bearing ready gate; rename with a `completion` prefix if another gate ever gains a retry loop.
- Resolution mirrors `readyCommand`: read from `cfg.projects[project.key]`. No ad-hoc-mode source.

## Task checklist

- Add `readyGateRetryBound?: number` to the `Project` type and config.md schema.
- Validate it as a non-negative integer at config load; add to the strict project-key allowlist and the unknown-key error message.
- Resolve the bound (per-project override else default 2) and thread it into `runCompletionReadyGate`'s retry loop, replacing the hardcoded constant for total-attempt computation — including the loop guard, the retry-check guard, and the `(attempt N/M)` progress-log denominator (all three derive `M` from the resolved bound, not the constant).
- Update docs.

## Acceptance criteria

- [ ] A per-project `readyGateRetryBound` config key is accepted by `loadConfig` when it is a non-negative integer (including 0).
- [ ] `loadConfig` rejects `readyGateRetryBound` that is negative, non-integer, or non-numeric, with an error naming the offending project and file.
- [ ] `readyGateRetryBound` is in the strict project-key allowlist; the unknown-key error message lists it among allowed keys.
- [ ] Absent the knob, the completion ready gate retries retryable red exactly 2 times (3 total attempts): `run.test.ts` red-then-green seam and always-red completion-gate tests stay green (behavior unchanged).
- [ ] With `readyGateRetryBound: N`, the completion ready gate re-runs retryable red up to N times (N+1 total attempts) before entering the fix-up loop.
- [ ] With `readyGateRetryBound: 0`, the completion ready gate runs once and enters the fix-up loop on retryable red without retrying.
- [ ] The `(attempt N/M)` progress log's denominator `M` equals the resolved bound + 1 (e.g. `readyGateRetryBound: 5` logs `attempt 1/6`, not `1/3`).
- [ ] A non-retryable red still short-circuits without retry regardless of the knob value.

## Documentation updates

- `v1/docs/config.md`: add `readyGateRetryBound` to the `Project` schema, the strict-keys allowlist sentence, and a per-project description paragraph.
- `v1/docs/run-loop.md`: completion-transition ready-gate section — note the retry bound defaults to 2 and is overridable per project via `readyGateRetryBound`.
- `v2/docs/v1-behaviors.md`: update the completion-gate retry-on-red entry to record that the bound is now the per-project `readyGateRetryBound` (default 2) rather than a fixed constant.
