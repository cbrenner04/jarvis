# 02 - Attention target detail resolution

## Problem

`01` makes an attention row selectable, but the right pane still resolves detail by walking the flattened, expansion-aware tree. That path auto-reveals ancestors of whatever node it resolves, so selecting a pin whose target sits under a collapsed pipeline or an unexpanded stage would paint newly-revealed tree rows even though `01` keeps `expandedPipelineNodeIds` untouched — violating the "reveals no ancestors" decision while its state-only criterion still passes.

## Decisions

- Right-pane detail for a selected attention row resolves its target node id directly against the pipeline/stage/run model — the same source the tree is built from — not against the flattened tree. Rules out a separate attention detail model, and rules out forcing expansion to inspect a pin.
- This resolution path does not call the ancestor-reveal codepath the tree-node selection handler uses. Selecting an attention row must not cause any node to newly appear in the painted left-pane tree, independent of what `expandedPipelineNodeIds` records. Rules out a naive dereference through the existing flattened-tree lookup, which would reveal ancestors as a side effect even while leaving the expansion set nominally unchanged.
- Detail resolves correctly for a target under a collapsed pipeline and for a target whose stage is not expanded, in both cases without expanding anything.

## Acceptance criteria

- [ ] Selecting an attention row renders its target node's existing right-pane detail, including a stage target whose pipeline is collapsed and a run target whose stage is not expanded; `tui-monitor-lines.test.ts` — `resolves attention target detail without expanding the tree` fails against the pre-fix code.
- [ ] Selecting an attention row whose target is nested under a collapsed pipeline or an unexpanded stage paints the same left-pane tree rows (same count, same content) as before the selection — not just an unchanged `expandedPipelineNodeIds`.
- [ ] `expandedPipelineNodeIds` is unchanged by attention-row selection (state-level check alongside the painted-row check above).
- [ ] `tui-monitor-lines.test.ts` — `resolves attention target detail without expanding the tree`; Mutation checkpoint: inverting the guard that bypasses ancestor-reveal makes the scoped test fail.
- [ ] `tui-monitor-lines.test.ts` — `resolves attention target detail without expanding the tree`; Keystone checkpoint: reverting attention-target detail resolution to the flattened-tree lookup makes the scoped test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — attention-target detail resolves against the pipeline/stage/run model directly, independent of collapse/expansion state, and never auto-reveals ancestors.
- `v2/docs/v1-behaviors.md` § TUI / observability — right-pane resolution of an attention target bypasses the flattened-tree ancestor-reveal path used for ordinary tree-node selection.
