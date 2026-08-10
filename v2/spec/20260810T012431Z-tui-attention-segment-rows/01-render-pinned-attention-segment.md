# Render the pinned attention segment

## Problem

The attention projection is not painted above the work tree or budgeted within a constrained left pane.

## Decision ledger

- Paint `── Needs attention (N) ──`, up to six projected rows, then display-only `+N more` when overflow is positive, before the existing work tree; leave the existing Queue segment after the tree. Heading `N` is the total actionable incident count before the cap. Rules out scroll-dependent pins or a capped heading count.
- Omit the complete attention segment when total actionable count is zero. Rules out an empty heading consuming pane height.
- Paint each row as selection marker, glyph, `what`, `where`, and `idle <age>` only when `sinceMs` is durable, using the existing elapsed formatter. Rules out fabricated age or duplicated tree columns.
- Reserve left-pane rows in segment order: the clipped attention segment first, then the work-tree viewport, then Queue. The tree budget is `max(0, pane height minus painted attention rows and the existing queue reservation)`; it never goes negative and leaves the full flattened tree unchanged. Rules out pins pushing tree rows beyond pane height or trimming selectable tree nodes.
- When the pane cannot fit the complete attention segment, Ink clips its ordered heading/rows/overflow prefix at pane height, the tree receives zero rows, and the capped attention selection set remains independent of that paint clipping. Rules out negative budgets, a partial row outside the pane, or viewport-dependent navigation.

## Prerequisites

- `00-build-attention-row-projection.md` supplies structured capped rows, total/overflow metadata, target node ids, and nullable durable timestamps.

## Task checklist

- Extend the pure left-pane derivation in `v2/src/tui/tui-monitor-lines.ts` to return attention display rows and budget the work-tree viewport beneath them.
- Paint those rows before work-tree rows through the generic segmented-row path in `v2/src/tui/tui-ink-monitor.tsx`.
- Add focused `v2/src/tui/tui-monitor-lines.test.ts` coverage for rendering, cap/overflow, empty state, durable/undated age, queue order, viewport budget, and constrained panes.
- Add an Ink render test through `v2/src/tui/tui-ink-monitor.test.tsx` for actual segment order and clipping rather than proving it solely from line projection.
- Add in-body `// @mutate` directives for the complete consumer integration and every added overflow, empty-state, age, viewport, queue-order, and clipping guard.

## Acceptance criteria

- [x] `tui-monitor-lines.test.ts` test `renders the pinned attention segment` fails against the pre-fix code and proves the heading and at most six attention rows paint before the work tree, with `+N more` only for overflow.
- [x] Seven actionable incidents paint heading count seven, six attention rows, and display-only `+1 more`; dated rows paint `idle <age>` from durable `sinceMs`, while undated legacy rows paint no age.
- [x] No actionable item paints no attention heading, row, or overflow summary and consumes no work-tree viewport row.
- [x] The existing Queue remains after the work tree; attention and queue reservations reduce the tree viewport no lower than zero without changing the full flattened tree.
- [x] `tui-ink-monitor.test.tsx` test `renders and clips pinned attention in the left pane` fails against the pre-fix code and proves the actual Ink left pane clips the attention segment in order on a pane too short for its heading, six rows, and overflow, and paints no tree row when the remaining tree budget is zero.
- [x] `tui-ink-monitor.test.tsx` — `renders and clips pinned attention in the left pane`; Keystone checkpoint: an in-body `// @mutate` directive disables the complete attention consumer integration and turns the scoped test red.
- [x] `tui-monitor-lines.test.ts` — `clips pinned attention before the work tree`; Mutation checkpoint: in-body `// @mutate` directives invert overflow rendering, empty-segment suppression, durable-age omission, queue order, attention viewport subtraction, and tree-budget floor, and each turns the scoped test red.
- [x] `tui-ink-monitor.test.tsx` — `renders and clips pinned attention in the left pane`; Mutation checkpoint: an in-body `// @mutate` directive disables the Ink clipping guard and turns the scoped test red.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — durable operator documentation lands with the completed navigation behavior in 02.

## Blocker

Artifact contract check failed: Hollow mutation checkpoints (the named mutation left the scoped suite green):
- /Users/christopherbrenner/.jarvis/worktrees/jarvis/20260810T012431Z-tui-attention-segment-rows/v2/src/tui/tui-monitor-lines.test.ts:730: // @mutate v2/src/tui/tui-monitor-lines.ts "projection.overflow > 0 ? [row(untoned(`+${projection.overflow} more`))] : []" -> "[row(untoned(`+${projection.overflow} more`))]" — scoped suite stayed green under this mutation
