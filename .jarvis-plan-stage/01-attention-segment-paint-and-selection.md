# 01 - Attention segment paint and selection

## Problem

The attention projection from `00` has no consumer: the operator still walks the work tree to find awaiting gates, rejected gates, failed stages, failed and blocked runs, and terminal-publication failures.

## Decisions

- Paint the projection as a pinned segment above the work tree in the left pane: one heading row, then the attention rows, then the tree. Rules out attention-by-scrolling.
- A row renders glyph (`✋` gate, `✗` failure), `what`, `where`, and age formatted from `sinceMs` through the existing wall-clock formatter; a `null` `sinceMs` renders no age. Rules out a display clock standing in for a missing timestamp.
- The segment consumes left-pane row budget ahead of the tree, so the tree viewport shrinks by the painted segment height. Rules out overpainting the pane.
- No actionable item paints no heading and no row. Rules out spending a pane row on an empty state.
- Attention row ids precede every tree node id in `monitorSelectableNodeIds`, so initial selection lands on the first attention row when one exists. Rules out interleaving pins with their tree rows, and rules out special-casing initial selection back to the tree.
- The overflow row is not selectable. Rules out navigation landing on a summary.
- Right-pane detail for a selected attention row resolves its target node id against the pipeline/stage/run model, not the flattened tree, so a target under a collapsed pipeline or an unexpanded stage still renders its existing detail. Rules out a separate attention detail model and rules out forcing expansion to inspect a pin.
- Selecting an attention row adds nothing to `expandedPipelineNodeIds` and reveals no ancestors. Rules out pin selection mutating tree state.
- Dock verbs and keybind steering are unchanged: an attention-row selection is not a run or pipeline id, so existing feedback codes refuse it. Rules out mixing command dispatch into this change.
- Pins clear only when their source leaves the projection (source resolved, or row dropped from daemon retention). Rules out dismissal state and a new command verb.

## Acceptance criteria

- [ ] With actionable work present, the left pane paints an attention heading and the projection's rows above the first work-tree row, each showing its glyph, `what`, `where`, and age (no age when the source has no durable timestamp); `tui-monitor-lines.test.ts` — `paints the pinned attention segment above the work tree` fails against the pre-fix code.
- [ ] Attention row ids precede every tree node id in `monitorSelectableNodeIds`, and initial selection lands on the first attention row when one exists.
- [ ] Selecting an attention row renders its target node's existing right-pane detail, including a stage target whose pipeline is collapsed and a run target whose stage is not expanded.
- [ ] The `+N more` overflow row is present in the painted segment and absent from `monitorSelectableNodeIds`.
- [ ] With no actionable item, the left pane paints no attention heading and no attention row, and the tree viewport keeps its full row budget.
- [ ] The painted attention segment reduces the tree viewport by its own height, so painted left-pane rows never exceed the pane height.
- [ ] Selecting an attention row leaves `leftPaneTreeScrollOffset` and `expandedPipelineNodeIds` unchanged.
- [ ] Dock steering (`kill`) with an attention row selected issues no RPC and reports an existing feedback code.
- [ ] `tui-monitor-lines.test.ts` — `keeps the overflow row unselectable`; Mutation checkpoint: inverting the overflow-row exclusion guard makes the scoped test fail.
- [ ] Every guard added by this subspec has a scoped test that fails when the guard is inverted, including the negative cases that suppress painting (empty projection paints no heading, overflow row yields no selectable id).
- [ ] `tui-monitor-lines.test.ts` — `orders attention row ids ahead of tree node ids`; Keystone checkpoint: reverting `monitorSelectableNodeIds` to tree rows only makes the scoped test fail.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — attention segment sources, glyphs, row anatomy, six-row cap plus `+N more`, gates-before-failures oldest-first ordering, undated rows last, empty state, attention ids ahead of tree ids in walk order, and target-node detail resolution independent of expansion.
- `v2/docs/v1-behaviors.md` § TUI / observability — attention row selection ids (`attention:<targetNodeId>`), their position in `monitorSelectableNodeIds`, initial-selection consequence, unselectable overflow row, and right-pane resolution of an attention target against the pipeline/stage/run model.
