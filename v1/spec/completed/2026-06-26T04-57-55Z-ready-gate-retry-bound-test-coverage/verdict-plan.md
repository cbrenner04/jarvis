## Verdict — Refinement required

The spec's core approach is sound: the `opts.runCompletionReadyGate` seam, deferring the real error-type→`retryable` classifier to out-of-scope, and the red→red→green test structure are all correct and need no change. However, several assertions as written do not actually pin the behavior the acceptance criteria claim. The following refinements are required.

**1. Non-retryable test must run at a bound ≥ 1 (load-bearing).**
With `retryable: false`, the early-exit fires before the retry block — so "no retrying message, gate called once" is observationally identical to what `readyGateRetryBound: 0` already produces. The test therefore proves nothing distinctive about non-retryability unless the configured bound is ≥ 1, where a *retryable* red at the same bound *would* have emitted a retry. The spec must pin a non-zero bound for this test (e.g. 2) and make explicit that the load-bearing assertion is the contrast: at this bound a retryable red retries, a non-retryable red does not.

**2. Specify the per-check counting mechanism.**
AC1 ("exactly bound+1 attempts within a single completion check") and AC2 ("not re-invoked within that completion check") both depend on isolating one completion check from the fix-up loopback's subsequent checks — but the single global seam closure cannot natively observe per-check boundaries. The spec must name how per-check isolation is achieved (e.g. a reset-on-first-call sentinel, or leaning on a green-terminating variant that returns before any second check exists). Without this the implementer cannot satisfy AC1/AC2 as stated.

**3. AC1 terminal-red assertion must use a distinctive substring.**
`ready gate failed` appears in both the retry line and the terminal-red line; asserting the bare substring does not prove the terminal-red path was reached. AC1 must assert the colon form that marks terminal red (matching the existing bound-0 test's `ready gate failed: `).

**4. Do not attribute the exact-count proof to Test 1's substring set.**
`not.toContain("attempt 3/3, retrying")` is guaranteed by the emission guard for *any* bound-2 run, and `1/3`+`2/3` proves only ≥2 retry emissions — neither pins "exactly 3 attempts in one check." The exact-count proof must rest on a direct per-check count assertion (ties to #2) or on the red→red→green test whose green return terminates before any loopback. Refine the AC/decisions so the count claim is carried by an assertion that genuinely establishes it.

**5. Sustained-red tests should assert the terminal outcome.**
The tests assert stderr substrings but never that the run actually terminates red. Add a cheap terminal assertion (non-zero exit / absence of `spec complete`) so the loop is proven to end rather than spin.

**6. Tighten the non-retryable failureText framing.**
Because the seam bypasses the classifier, only `retryable: false` drives behavior; the commit/push-flavored text is unobserved. Remove any claim that the test verifies how the classifier flags commit/push failures (that is explicitly out of scope) — realistic text is fine, but the prose must not imply classifier coverage.

**7. Reframe AC4 as a preservation citation.**
The override/default coverage is fully satisfied by the pre-existing `attempt 1/7` and `attempt 1/3` tests and requires no new work. Per spec-guidance's behavior-preserving-AC rule, write it as a "stays green" citation of those tests rather than an unchecked new-work checkbox.

Rationale: the intent is test-coverage for the retry bound; an acceptance criterion that is satisfied by behavior other than the one it names (here, by bound-0 equivalence, by the emission guard, or by a non-distinctive substring) fails to guard against the regression it claims to. Findings #1 and #2 are load-bearing; the remainder are precision fixes that keep each AC's proof aligned with its claim.