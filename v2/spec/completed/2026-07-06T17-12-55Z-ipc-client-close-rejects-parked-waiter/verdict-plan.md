## Verdict: Required Refinements

1. **Timer cleanup on the timed branch.** Add a decision that on `close`, if the parked waiter is the timed variant, its pending timer must be cleared before rejecting. Without this, the fix leaves a stale timer alongside the same class of dangling-async-work bug the spec exists to close. Rationale: the intent's own framing (a hang caused by an unsettled waiter) demands the fix not introduce an analogous leak.

2. **Precise waiter-state shape.** State explicitly that the existing single parked-waiter slot is extended to carry `reject` alongside `resolve` (e.g., `{resolve, reject} | null`) — not a second, branch-local variable. The unbounded and timed branches share one slot today; the decisions must not read as if they're separate state. This closes an implementation ambiguity that could otherwise produce redundant or inconsistent state.

3. **Mechanical runbook acceptance criterion.** Replace the current prose-graded criterion ("removed or updated to reflect this fix...") with a binary, checkable condition — e.g., the dated CI-flake gotcha entry no longer appears in `v1/docs/operator-runbook.md` § The gate. Per spec guidance, acceptance criteria must verify observable state, not grade prose quality.

4. **Restore the `readTailFrame` connective sentence.** Reinstate one sentence (in Decisions or the intro) noting that `readTailFrame` already maps `"connection closed"` to `TuiDaemonConnectionError`, which is why the fix's scope stops at `client.ts` with no follow-on change needed in `tui-log-tail-client.ts`. This is load-bearing context for why the subspec boundary is correct.

5. **Soften the CI-flake causation claim.** Adjust language so the spec doesn't imply the deterministic unit test reproduces or proves fix of the intermittent CI race. State instead that the fix removes the hang mechanism (no settlement on close) that could cause the wedge; the unit test covers that mechanism directly, while the CI race itself remains inherently non-deterministic and isn't independently re-tested. Do not add a new flaky-race reproduction test — that would be scope creep the spec's own "out of scope" section should continue to resist.

6. **One-line note on close origin coverage.** Add a sentence clarifying that both consumer-initiated and remote socket close fire the same `close` handler, so the single rejection test covers both paths by construction — no separate test is required for each origin.

No findings challenge the spec's core scope (client.ts-only fix, no timeout/protocol changes) — that boundary stands as-is.