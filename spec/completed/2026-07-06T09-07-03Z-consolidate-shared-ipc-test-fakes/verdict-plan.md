## Verdict: Required Refinements

**1. Fix the `makeIpcClient` delivery-semantics defect (upheld, blocking).**

The spec's decision that the consolidated `makeIpcClient` should adopt the tui implementation's send-gated delivery model (`nextFrame()` only resolves when `deliveredCount < sentCount`) is incorrect and will hang at least one existing test. `cli.test.ts`'s streaming test (log replay/follow, ~line 1086) sends a single `stream-open` frame but calls `nextFrame()` four times to drain four queued response frames. Under send-gating, only the first `nextFrame()` call resolves; the remaining three see `deliveredCount == sentCount` and block forever, since no further `send()` occurs. This directly contradicts the intent's explicit requirement that both test files "pass unchanged," and it invalidates the spec's stated rationale that the tui model is a "strict superset" of cli's.

**Required outcome:** The spec must specify delivery semantics for `makeIpcClient` that satisfy both files' existing call sites without hanging:
- cli's static-array queue needs frames delivered on every `nextFrame()` call regardless of send count (ungated).
- The spec must confirm (or explicitly instruct the implementer to confirm) whether any tui test relies on send-gating to detect an out-of-order or premature-read bug. If no such reliance exists, the spec should adopt cli's simpler ungated queue semantics as the shared behavior. If reliance is found, the spec must reconcile the conflict explicitly (e.g., two distinct helper behaviors, or a parameter) rather than silently picking one and hoping it's compatible.
- This changes the "strict superset" claim in the Decisions section — it must be corrected or removed rather than left as an inaccurate premise for the merge.

**Rationale:** Per the intent's Verification section, both test files must pass unchanged after consolidation — a hang is a hard failure, not a style nit. Per spec-guidance's requirement that decisions keep work bounded and correct, a decision resting on an unverified/false claim ("strict superset") must be corrected before the subspec is actionable.

**2. Verify all tui call sites of `makeClient`/`createDeferredClient` before finalizing the merged semantics.**

The advocate flagged but did not complete this check. The spec (or its acceptance criteria) should require that the chosen delivery/queue semantics be validated against every existing tui test call site — not just asserted by analogy — before the consolidated helper is considered correct. This can be folded into refinement of point 1: the spec should not finalize a "superset" or "cli semantics win" claim without this check being part of the acceptance path.