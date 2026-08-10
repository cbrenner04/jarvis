## Required refinements

1. Define attention-target resolution so attributed runs remain resolvable when their ancestors are collapsed or the run is not the group’s representative. Require focused coverage proving the existing target detail is shown while the attention ID remains selected.

2. Correct awaiting-gate timing for every predecessor type: workflow predecessors use durable `endedAt`; approval predecessors use durable `decidedAt`; missing durable timestamps yield no age.

3. Require publication-failure age to come from a provably durable terminal timestamp. A snapshot value that may fall back to pipeline creation time cannot satisfy the intent’s no-fabrication requirement.

4. State incident cardinality explicitly. Failed stages and their failed constituent runs are separate rows, and multiple ad-hoc failures may share one target. Heading totals, overflow, IDs, and cap behavior must follow that policy.

5. Define canonical reconciliation for duplicate pipeline snapshots, including source precedence, and require a contradictory-snapshot test. Otherwise duplicate or stale incidents can be projected.

6. Make ordering total and deterministic when timestamps and target IDs tie, including at the six-row cap boundary. Shared targets require a final stable row-identity tie-break.

7. Clarify that pipeline-backed `where` uses the stage fan-out `branchKey`, while ad-hoc rows use the established ad-hoc label. This avoids conflating workflow branches with daemon Git branches.

8. Define coexistence with the existing queue and constrained pane heights: segment order, tree-budget floor at zero, and clipping behavior must be explicit and tested, including panes too short to paint the complete attention segment.

9. Split the oversized wiring subspec into independently testable slices covering rendering/layout and navigation/detail/state behavior. Assign every original task, documentation update, and acceptance outcome exactly once across the replacements, and link every replacement from `index.md`. Tests must exercise the actual Ink and entry-control seams where pure line projection cannot prove behavior.

10. Narrow state-preservation claims to the intent’s durable state: stored tree scroll offset and explicit expansion remain unchanged. Do not promise identical effective tree rendering, since selection-derived expansion may change; account for any established selection side effects such as clearing steering feedback.

11. Replace the proposed keystones with genuine baseline-semantic reversions: one disabling the attention projection as a whole and one disabling the complete consumer integration. Keep source filtering, ordering, selectable-prefix, aliasing, viewport, and preservation mutations as guard checkpoints. This is required by the mutation guidance’s distinction between headline behavior and individual guards.
