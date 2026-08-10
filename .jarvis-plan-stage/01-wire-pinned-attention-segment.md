# Wire the pinned attention segment

## Problem

The attention projection is not painted, navigable, or connected to existing target detail.

## Decision ledger

- Paint `── Needs attention (N) ──` and up to six projected rows above the work-tree viewport, followed by display-only `+N more` when overflow is positive; heading `N` is the total actionable count before the cap. Rules out scroll-dependent pins or a capped heading count.
- Omit the complete attention segment when total actionable count is zero. Rules out an empty heading consuming pane height.
- Paint each row as selection marker, glyph, `what`, `where`, and `idle <age>` only when `sinceMs` is durable; use the existing elapsed formatter. Rules out fabricated age or duplicated tree columns.
- Subtract the painted attention heading, rows, and overflow row from the work-tree viewport budget while leaving the full flattened tree unchanged. Rules out pins pushing tree rows beyond pane height or trimming selectable tree nodes.
- Prefix selectable order with the six visible attention ids, then every full-flatten tree id; never include the overflow row. Rules out navigation landing on a summary or dropping off-pane tree nodes.
- Resolve an attention selection to its target only inside the existing right-pane detail projection; keep the attention id in monitor state and pass the original selection, scroll offset, and explicit expansion to left-pane derivation. Rules out a separate attention detail schema or implicit reveal/movement.
- Selecting an attention row may change only `selectedNodeId`; it does not mutate `leftPaneTreeScrollOffset` or `expandedPipelineNodeIds`. Rules out selection-driven tree scrolling or expansion.
- Keep approve/reject dispatch and Enter-to-reveal deferred to `tui-attention-row-act-in-place`. Rules out widening the interaction surface in this change.

## Prerequisites

- `00-build-attention-row-projection.md` supplies structured capped rows, total/overflow metadata, target node ids, and nullable durable timestamps.

## Task checklist

- Extend the pure left-pane derivation in `v2/src/tui/tui-monitor-lines.ts` to return attention display rows and budget the tree viewport beneath them.
- Paint those rows before work-tree rows through the generic segmented-row path in `v2/src/tui/tui-ink-monitor.tsx`.
- Prefix `monitorSelectableNodeIds` with visible attention ids and alias attention selection to its target in the existing right-pane projection only.
- Add focused `v2/src/tui/tui-monitor-lines.test.ts` coverage for rendering, cap/overflow, empty state, selectable order, target detail, viewport preservation, scroll, and explicit expansion.
- Add in-body `// @mutate` directives for the headline wiring and every added ordering, overflow, empty-state, viewport, and target-resolution guard.
- Update the durable operator, parity, and command-center status documentation.

## Acceptance criteria

- [ ] `tui-monitor-lines.test.ts` test `renders and navigates the pinned attention segment` fails against the pre-fix code and proves the heading and at most six attention rows paint before the work tree, with `+N more` only for overflow.
- [ ] Seven actionable items paint heading count seven, six selectable attention rows, and display-only `+1 more`; attention ids precede every full-flatten tree id in `monitorSelectableNodeIds`.
- [ ] No actionable item paints no attention heading, row, or overflow summary and consumes no work-tree viewport row.
- [ ] Dated attention rows paint `idle <age>` from their durable `sinceMs`; undated legacy rows paint no age.
- [ ] Selecting an attention row renders its target node's existing right-pane detail while monitor state retains the attention id.
- [ ] Selecting an attention row leaves `leftPaneTreeScrollOffset` and `expandedPipelineNodeIds` unchanged, and the tree remains painted at the same offset beneath the pin segment.
- [ ] `tui-monitor-lines.test.ts` — `renders and navigates the pinned attention segment`; Keystone checkpoint: an in-body `// @mutate` directive removes attention ids from the selectable-order prefix and turns the scoped test red.
- [ ] `tui-monitor-lines.test.ts` — `attention selection reuses target detail without moving the tree`; Mutation checkpoint: in-body `// @mutate` directives invert target aliasing, overflow exclusion, empty-segment suppression, attention viewport subtraction, scroll preservation, and expansion preservation, and each turns the scoped test red.
- [ ] `v2/docs/operator-runbook.md` § Observe documents sources, glyphs, row anatomy, six-row cap, total/overflow count, gate-first and oldest-first ordering, undated rows, empty state, selectable order, and target-detail reuse.
- [ ] `v2/docs/v1-behaviors.md` § TUI / observability records separately namespaced attention selection ids and target-node detail resolution.
- [ ] `v2/spec/tui-command-center-brief.md` records attention segment rows as shipped without marking deferred act-in-place behavior complete.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — attention sources, glyphs, anatomy, cap, ordering, timestamps, empty state, selection order, and target detail.
- `v2/docs/v1-behaviors.md` § TUI / observability — attention selection ids and target-node detail reuse.
- `v2/spec/tui-command-center-brief.md` — mark segment-row delivery only; retain deferred interaction work.
