# Selected collapsed member resolves its own ancestors

## Problem

`buildStageNodes` joins each stage's runs with `buildWorkflowTableRows(stageRuns, builderRuns, new Set())` — collapsed — so a stage's join-time `runs` carry exactly one node per workflow invocation, keyed by the group representative's run id. `resolveSelectedAncestors`/`resolveBranchAncestors` match selection with `run.id === selectedNodeId`, so a selected run id belonging to a collapsed group but not its representative matches nothing: ancestors resolve to the empty set, the stage never enters `effectiveExpansion`, and selection points at an id no node in the flattened tree carries. Marking is exact run-id equality, so this is the invisible-id case, not aliasing onto the representative. The operator cannot land selection on the actual member. Prerequisite for wiring Enter-reveal to collapsed attention targets.

The expansion machinery downstream already handles this once ancestors resolve: `stageRunsForExpansion` re-joins the stage with `new Set([invocationId])`, materializing every non-representative member as its own `workflow-child` run node whose id is that member's run id. The missing piece is ancestor resolution.

## Decisions

- A stage run node's ancestors are resolved when the selected id equals the node id **or** matches any member of that node's table row (`workflowTableRowMembers(run.tableRow)`) — a member-match arm added to the run-match sites — rules out leaving selection on an id no flattened node carries.
- The keystone (reverts to pre-fix identity-only comparison) targets the new predicate itself; the guard checkpoint for the member-match arm targets the distinct branch-site call (`resolveBranchAncestors`), not the same edit as the keystone. The two run-match call sites (`resolveSelectedAncestors`'s stage loop and `resolveBranchAncestors`) return different `Set` literals, so full-line `@mutate` anchors stay unique at both sites.
- Reveal rides the existing selected-ancestor path into `resolveEffectiveExpansion`; the caller-supplied `expandedNodeIds` set is neither written to nor mutated. The naive alternative — writing the resolved stage/branch/pipeline ids into the caller's set from the reveal path — is exactly what this rules out; `resolveEffectiveExpansion` already unions into a fresh `Set`, so the constructible violation is a reveal path that mutates `expandedNodeIds` in place instead.
- Member lookup reads the run node's own `tableRow`, not `builderRuns` — rules out threading the builder-run list into ancestor resolution, which `resolveSelectedAncestors` does not receive today.
- Ad-hoc collapsed groups (`buildAdHocNodes`) are out of scope: ancestor resolution walks pipeline nodes only, and ad-hoc nodes have no expansion path at all, so a non-representative ad-hoc member reproduces the intent's problem but is unreachable by this fix. Deferred to a separate spec.
- Scope stops at the tree projection: no input-binding or attention-segment changes — rules out folding the Enter binding into this change.

## Task checklist

- [ ] Add a member-aware run-match predicate over `MonitorPipelineTreeRunNode` and use it at both run-match sites (`resolveSelectedAncestors`, `resolveBranchAncestors`).
- [ ] Update the existing `@mutate` directive in `tui-monitor-pipeline-tree.test.ts` that quotes the branch run-match line, whose text this change replaces.
- [ ] Add regressions to `v2/src/tui/tui-monitor-pipeline-tree.test.ts` for the reveal, the branch-nested reveal, the untouched expansion set, and the representative/already-visible cases.
- [ ] Update `v2/docs/v1-behaviors.md` § TUI / observability.

## Acceptance criteria

- [x] Selecting a collapsed non-representative workflow member's run id resolves that member's pipeline and stage ancestors, so the flattened tree materializes it as its own run node at the expected depth — `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `selecting a collapsed non-representative member materializes it as its own row`; Keystone checkpoint: the linked directive reverts the run-match predicate to the pre-fix identity-only comparison, and the test fails against the pre-fix code.
- [x] A collapsed non-representative member nested under a branch resolves with pipeline, branch, and stage ancestors, materializing its own run node under that branch — `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a branch-nested collapsed member materializes under its branch and stage ancestors`; Mutation checkpoint: the linked directive neuters the member-match arm at the branch-site call in `resolveBranchAncestors`, a site distinct from the keystone's predicate-body target, so it reports no member match.
- [x] Branch-ancestor resolution for a directly-selected representative run id stays pinned under the rewritten matching — `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `selecting a run under a branch expands that branch only and leaves sibling branches collapsed`; its existing `@mutate` directive is repaired to target the rewritten branch-site match expression (replacing the pre-fix identity-only line it previously quoted).
- [x] Revealing a collapsed member's ancestors does not write into the caller-supplied `expandedNodeIds` set — reachable via the naive reveal-path implementation the second Decision rules out (writing resolved ids into the caller's set in place instead of unioning into a fresh one) — `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `revealing a collapsed member leaves the caller expansion set unmodified`.
- [x] Selecting a group representative, and selecting a member of an already-expanded stage, each materialize exactly one run node per member with unchanged node ids — `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `selecting a representative or an already-visible member materializes each member row once`.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` § TUI / observability — a selected run id belonging to a collapsed workflow group resolves that group's stage (and branch) ancestors, so the member materializes as its own run node in the flattened tree; the caller's explicit expansion set is not written. Ad-hoc collapsed groups are unaffected (out of scope).
