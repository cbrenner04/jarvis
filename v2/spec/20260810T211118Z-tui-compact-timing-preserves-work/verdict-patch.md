## Verdict — changes required

**1. Restore a discriminating keystone mutant (blocking).**

The keystone `@mutate` directive in `v2/src/tui/tui-monitor-pipeline-tree.test.ts` currently replaces `return elided.length > width ? work : elided.padEnd(width);` with `return elided.padEnd(width);`. That mutant is *equivalent* for the pinned input: `elided` is `"w23h/i…"` (7 chars), so the dropped guard never fires and both original and mutant return `"w23h/i… "`. The checkpoint passes green and proves nothing, yet AC 1 is ticked against it.

Required outcome: the keystone directive must name a mutant that reintroduces the regression the spec exists to prevent — the left-clip (`formatted.slice(formatted.length - width)`) that renders `w23h/i100d` as `3h/i100d` — and both compact-overflow tests must go red against it. Adapting the *anchor* text to the landed line (the hoisted `work` local) is correct and should be kept; only the replacement was weakened. The guard-checkpoint directive on the width comparison is fine as landed.

**2. The defensive `work` fallback must still fill the cell.**

Line 318's fallback returns a bare `work` string with no padding — the only branch that does not return exactly `width` characters, breaking the fixed-column invariant the cluster layout depends on. It is reachable more cheaply than the spec assumed: a corrupt/epoch `startedAt` yields `w20000d` (7 chars), whose elided form overflows eight columns, producing a one-column misaligned cell. Pad it to the cell width. Do not clip it — Decision 3's no-clip rule stands.

**3. Derive the work-only form from `compact`, not a hardcoded `true`.**

Line 316 passes a literal `true` where the enclosing branch already guarantees compactness. Provably equivalent today, but it hides the invariant; pass the parameter.

**4. Optional tidy:** the `expect(cell).toHaveLength(8)` at the retitled overflow test is now subsumed by the exact-literal assertion the same test makes; drop it. (The non-compact test's length assertion stands alone and should stay.)

Not upheld: the claim that the elided form's left-alignment is unpinned (both compact-overflow tests assert the trailing space, so a `padStart`/`padEnd` swap goes red), and the claim that the two compact-overflow tests are redundant (AC 1 and AC 2 pin distinct properties by spec design — keep both).

Everything else in the change is sound: the reachable behavior is correct, both doc homes are accurately updated, and the new non-compact test genuinely drives the previously uncovered 20-column overflow path.