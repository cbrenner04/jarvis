## Verdict — Refinement required

**Upheld: the sustained-red count proof is not genuine.**

The sustained-retryable-red test (AC1) names a "reset-on-bound sentinel" as the mechanism that proves the gate runs exactly `bound + 1` times within a single completion check. As implemented, that proof is hollow:

- The per-check count is **assigned a literal value**, not measured. An assertion comparing a hard-coded constant to itself cannot fail on the off-by-one regression AC1 exists to catch.
- The mechanism that triggers the record fires only because the fix-up loopback opens a **second** completion check — exactly the cross-check contamination the spec's "per-check isolation" decision was written to exclude. This also makes the test fragile: if the stuck-red/fix-up control flow ever stops issuing that second check, the test fails for a reason unrelated to the retry bound.

Net: AC1's distinctive count proof currently rests entirely on the `attempt 1/3 … 2/3 … not 3/3` substring sequence — which the spec's own refinement record already deemed insufficient to pin an exact count — while the named guard contributes nothing.

### Required outcomes

1. **Remove the tautological, loopback-coupled sentinel.** No assertion in the sustained-red test may depend on a literal count value or on a second completion check existing. The sustained-red test should assert only what it genuinely establishes: the `/3` denominator retry sequence, the terminal-red colon line (`ready gate failed:`), and a red termination proxy.

2. **Carry AC1's exact `bound + 1` count proof on the red→red→green variant.** That variant returns green on the third attempt before any loopback, so its `gateCalls === 3` assertion is an uncontaminated, genuine count measurement. The spec's decisions already designate this variant as the count-proof carrier; the implementation and the AC framing must make that the actual basis for the count claim, not the sustained-red sentinel. Reconcile AC1/AC3 so the count claim lives with the assertion that establishes it.

3. **Type the gate seam to its real return shape.** Replace the `any`-typed gate-impl seam (and its lint suppression) with the actual completion-ready-gate result type, so a malformed return shape is caught rather than silently accepted. (Minor; do it since the test is being touched.)

### Not required (over-reaches — do not act)

- **Do not add `not.toContain("spec complete")`.** `spec complete` is emitted before the completion ready gate runs, so a red gate run legitimately prints it; this assertion would break the tests. The non-zero exit code is the correct and sufficient red-termination proxy.
- **Substring-style consistency** between the new `attempt 1/3), retrying` form and the siblings' `attempt 1/3` is cosmetic; no change needed.

### Rationale

The intent is regression coverage for the retry bound. An acceptance criterion satisfied by something other than the behavior it names — here, by a self-comparing constant and by incidental loopback structure rather than by a measured per-check count — does not guard against the regression it claims to. The count proof must rest on an assertion that genuinely measures the count (the green-terminating variant), and the sustained-red test must stop asserting a fabricated number.