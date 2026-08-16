## Verdict — refinements required

**1. Reprompt contexts must not mask each other across iterations.**
Today each reprompt arm sets its own pending context but leaves the sibling's context set, and prompt selection always prefers the mutation-directive context. A reachable sequence — an unparseable miss reprompts, the agent removes the bad directive, the next report is a pure unlinked-keystone miss — leaves the stale mutation-directive prompt rendering a directive list for directives that no longer exist, and the keystone prompt is never shown until the iteration budget burns out. Required outcome: when either reprompt arm records its context, the other reprompt's pending context is no longer in effect, so the prompt the next iteration renders always matches the miss that produced it. The fixed precedence order stays as specified; it just must not apply to a context left over from an earlier iteration.

**2. Resume must restore at most the most recent reprompt context.**
The write-loop-input recovery helpers scan the log tail independently, so a run whose log carries both a `mutation_directive_reprompt` and a later `keystone_directive_reprompt` restores both, and the older mutation context wins selection — reproducing (1) after a pause. Required outcome: resume reconstructs the reprompt context corresponding to the *last* reprompt event in the log, and does not carry a superseded one alongside it.

**3. Cover both with a test.**
The subspec's checklist item on reprompt-context lifecycle is not currently graded across a non-settling iteration. Required outcome: a test that drives an unparseable-directive reprompt followed by a pure unlinked-keystone miss and asserts the second iteration renders the keystone reprompt (not the stale mutation one). Extend coverage to the two-event resume case if it can be done without a second heavyweight fixture.

**4. Correct the precedence claim in the spec Decisions text and `v2/docs/write-behavior.md`.**
Both currently assert that true contention "does not arise" because a mixed report hard-blocks. That reasoning holds only within a single report; contention arises across iterations, which is exactly (1). Required outcome: the documented rule states that precedence is fixed *and* that the sibling context does not survive into the next iteration/resume — matching the behavior after (1) and (2).

**5. Minor, only while editing the affected function:** normalize the inconsistent emptiness checks (`!== 0` vs `> 0`) in the multi-section blocker assembly in `v2/src/execution/write.ts`.

Not upheld — no action: the multi-section blocker reason is mandated by acceptance criterion 4 and graded by the malformed-pin and mixed-hollow tests; the optional `pinPath` on the shared checkpoint entry type is an explicit spec decision with stated rationale; the unresolved-pin criterion is genuinely unchanged and already covered by existing verifier/write tests; the coarse text pre-filter is intentional with the loop's full report re-verification as the authoritative gate; the nine-parameter shared boundary helper is acceptable extraction, and tightening it is out of scope.