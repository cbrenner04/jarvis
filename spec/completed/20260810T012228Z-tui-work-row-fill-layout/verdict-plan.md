1. Split the oversized subspec into independently testable semantic-row, display-width composition, and Ink interaction slices. Assign every existing task, acceptance outcome, documentation update, and checkpoint exactly once, and link every replacement from `index.md`.

2. Define the supported width range, minimum label allocation, derived narrow-width floor, and behavior below that floor. The current one-line, hierarchy, status, and label guarantees cannot all hold at arbitrarily small widths.

3. Make each row kind’s degradation contract unambiguous: atom order, removal order, empty-atom and separator cleanup, label/padding priority, compact-status substitution, and the condition under which the full cluster fits. Replace the undefined “reference width” with a verifiable condition or fixture.

4. Resolve the branch-floor conflict with the intent. The narrow floor must retain status only unless “current stage + status” is deliberately defined as one indivisible compact-status atom and recorded as an intentional decision.

5. Define elapsed semantics for branch rows. Branch elapsed is newly introduced behavior, so its timestamp source cannot be covered by a generic preservation claim.

6. Specify full- and narrow-width cluster behavior for ad-hoc top-level nodes, including their elapsed and compact-status semantics.

7. Define expandability precisely: either structural child presence or expansion-capable node kind. Empty nodes must have an explicit, tested glyph/toggle outcome because the glyph communicates whether children are hidden.

8. Cover the full reachable depth range, including depth 3, preferably through a depth-to-offset invariant rather than only examples at depths 0–2.

9. Make display-width behavior testable for wide characters, combining sequences, and the shipped glyphs; include ZWJ sequences if the selected width primitive promises grapheme-aware measurement.

10. Complete the attention contract with positive `rejected` coverage, an authoritative gate-classification source, pipeline-local counting, and explicit handling of reachable placeholder or missing-definition states.

11. Separate new selection behavior from preservation claims. Require row-wide inverse selection and no caret as new behavior, while citing existing tests that preserve pipeline/stage elapsed, labels, collapsed suffixes, live text/tone, status tones, and actual segment-tone attachment. This follows the guidance that behavior-preserving criteria cite concrete tests rather than paraphrase broad invariants.

12. Keep failing-test, keystone, and mutation checkpoints aligned with the split production seams. Each runtime-behavior subspec must name a test that fails against the pre-fix behavior, and each added or modified guard must have linked positive and negative coverage.
