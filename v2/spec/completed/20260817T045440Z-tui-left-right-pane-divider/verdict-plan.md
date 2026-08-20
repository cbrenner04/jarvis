## Verdict — refine

Five required refinements, plus four ledger-hygiene additions. No split: the change is one seam (`computeShellLayout` and its sole monitor-render consumer), and the downstream width consumers derive from it.

### Required

1. **AC #2 names a claim its fixture cannot produce.** The existing right-pane wrap fixture's widest row is ~129 display columns, so at 245 columns nothing wraps at either 133 or 134 — a test built on it is green before and after the change, contradicting the criterion's "fails against the pre-fix code" requirement (spec guidance: every runtime-behavior subspec must name a test that actually fails on the baseline). The fixture is also deliberately full of wide/combining graphemes, and the wrapper breaks early before a wide grapheme, so an exact-column assertion needs an all-narrow row. The spec must require a **new** all-narrow detail row exceeding 134 display columns, pin exactly-134 pre-fix versus exactly-133 post-fix, and say in the task checklist that the fixture is added rather than reused.

2. **The divider's vertical fill is an unmade decision with a crash edge.** The ledger says "one-column, `paneHeight`-tall flex child" without saying how the column is filled down the pane band, and `paneHeight` (`rows - DOCK_HEIGHT`) is unclamped while the render suite already constructs layouts from small row counts. A repeat-based fill throws at rows ≤ dock height. The ledger must decide the fill shape and require the height to be floored at zero so short terminals render rather than crash.

3. **The render guard's opposite inversion is unproven.** Repo rule: every added guard must have both directions covered — the spec pins forcing the divider-inclusion guard false, but not forcing it true. Without that, the stacked half of the render assertion is unproven as load-bearing. Add the second mutation directive against the same render test.

4. **AC #3's "display column 111" does not say how it is measured.** Measuring `line[111]` and measuring `Bun.stringWidth(prefix) === 111` diverge on rows carrying wide or combining graphemes, and the render test file measures by display width everywhere else. The criterion must state the measure and the row basis it applies to.

5. **The width sum is pinned only at the nudge-zero point.** Both nudge clamp edges are operator-reachable via `[`/`]` and are exactly where the left/divider/right arithmetic can break; the existing nudge tests assert deltas and left widths, not the sum. AC #1 must extend the sum invariant to the ceiling and floor clamp cases at a representative wide terminal.

### Ledger additions (state the decision, don't change the math)

6. **No gutter.** Right-aligned left-pane content and first-column right-pane content will sit flush against the rule (`…12m 3s│Pipeline`). That follows directly from the intent's decision that left keeps its width, the divider takes one column, and right takes the remainder — so record it explicitly, so an implementer does not invent padding that breaks the width sums.

7. **`dividerWidth` alongside the existing `dividerOffset`.** One sentence distinguishing the two (offset = where the boundary sits, driven by the `[`/`]` nudges; width = how many columns it occupies) preempts the reviewer question. Do not rename — `dividerOffset` is documented operator vocabulary.

8. **Divider must not shrink.** Neither pane box currently sets `flexShrink`, and a one-column child is the first thing a stale-resize frame squeezes out. Record the intended behavior.

9. **Doc scope beyond the figure block.** Both docs carry split-layout shape prose outside the width-figure block named in the Documentation updates section; that prose stays incomplete rather than wrong after the change. Name those sites so they are revised in the same pass.

### Not upheld

- Requiring literal `@mutate` directive text inside the mutation-checkpoint criteria: the criteria already carry the canonical selecting suffix, and the directive belongs in the pinning test file.
- Renaming `dividerWidth` (see 7).
- The "theme-consistent" wording: the ledger already narrows it to glyph-and-tone consistency, which is the accurate claim.