# Selected collapsed member resolves its own ancestors

## Problem

`buildStageNodes` joins each stage's runs with `buildWorkflowTableRows(stageRuns, builderRuns, new Set())` — collapsed — so a stage's join-time `runs` carry exactly one node per workflow invocation, keyed by the group representative's run id. `resolveSelectedAncestors`/`resolveBranchAncestors` match selection with `run.id === selectedNodeId`, so a selected run id belonging to a collapsed group but not its representative matches nothing: ancestors resolve to the empty set, the stage never enters `effectiveExpansion`, and selection points at an id no painted row carries. The operator cannot land selection on the actual member. Prerequisite for wiring Enter-reveal to collapsed attention targets.

The expansion machinery downstream already handles this once ancestors resolve: `stageRunsForExpansion` re-joins the stage with `new Set([invocationId])`, materializing every non-representative member as its own `workflow-child` run node whose id is that member's run id. The missing piece is ancestor resolution.

## Decisions

- A stage run node carries a selection when the selected id equals the node id **or** matches any member of that node's table row (`workflowTableRowMembers`) — rules out aliasing selection onto the representative and rules out leaving selection on an invisible id.
- Reveal rides the existing selected-ancestor path into `resolveEffectiveExpansion`; the caller-supplied `expandedNodeIds` set is neither written to nor mutated — rules out a durable expansion write for a transient reveal.
- Member lookup reads the run node's own `tableRow`, not `builderRuns` — rules out threading the builder-run list into ancestor resolution, which `resolveSelectedAncestors` does not receive today.
- Scope stops at the tree projection: no input-binding or attention-segment changes — rules out folding the Enter binding into this change.

## Task checklist

- [ ] Add a member-aware selection predicate over `MonitorPipelineTreeRunNode` and use it at both run-match sites (`resolveSelectedAncestors`, `resolveBranchAncestors`).
- [ ] Update the existing `@mutate` directive in `tui-monitor-pipeline-tree.test.ts` that quotes the branch run-match line, whose text this change replaces.
- [ ] Add regressions to `v2/src/tui/tui-monitor-pipeline-tree.test.ts` for the reveal, the branch-nested reveal, the untouched expansion set, and the representative/already-visible cases.
- [ ] Update `v2/docs/v1-behaviors.md` § TUI / observability.

## Acceptance criteria

- [ ] Selecting a collapsed non-representative workflow member's run id materializes that member as its own painted selected tree row with its pipeline and stage ancestors expanded — `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `selecting a collapsed non-representative member paints it as its own row`; Keystone checkpoint: the linked directive reverts run matching to the pre-fix representative-only identity comparison, and the test fails against the pre-fix code.
- [ ] A collapsed non-representative member nested under a branch reveals with pipeline, branch, and stage ancestors expanded — `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a branch-nested collapsed member reveals under its branch and stage ancestors`; Mutation checkpoint: the linked directive neuters the member-materialization guard so it reports no member match.
- [ ] The reveal leaves the caller-supplied explicit expansion set unchanged — `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `revealing a collapsed member leaves the caller expansion set unmodified` stays green (no explicit-expansion write).
- [ ] Selecting a group representative, and selecting a member of an already-expanded stage, paint each member exactly once with unchanged node ids — `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `selecting a representative or an already-visible member paints each member row once`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` § TUI / observability — a selected run id belonging to a collapsed workflow group resolves that group's stage (and branch) ancestors, so the member paints as its own selectable row; the caller's explicit expansion set is not written.
