# Frame Work and Queue sections

## Problem

The left pane gives Needs attention a ruled heading, leaves the work tree headingless, and labels queued work with a bare `Queue`, so the three stacked sections run together. Adding a Work heading without reserving its row would also overflow the existing tree viewport budget.

## Decision ledger

- Paint `── Work (N) ──` before a non-empty work tree, where `N` is the count of depth-zero nodes in the same full tree model used for display. Rules out counting flattened descendants or deriving a second tree model that can drift.
- Paint `── Queue (N) ──` before queued rows, where `N` is the queued-row count. Rules out retaining the bare Queue label or counting non-queued runs.
- Omit Work and Queue headings when their sections are empty. Rules out empty framing rows consuming pane height.
- Use ruled headings as the only section separation, with no blank spacer rows. Rules out reducing useful left-pane capacity for redundant padding.
- Reserve one Work heading row alongside the painted attention rows and Queue heading in the tree budget, floored at zero; keep the full flattened tree and selection model unchanged. Rules out pane overflow, negative slicing budgets, or removing off-viewport nodes from navigation.
- Keep pane geometry, attention projection, queued-row content/order, tree selection/expansion, right pane, and dock unchanged. Rules out widening this presentation change into layout or command behavior.

## Task checklist

- Derive ruled Work and Queue headings in `v2/src/tui/tui-monitor-lines.ts`, using the full work-tree top-level count and queued-row count respectively.
- Render the Work heading between attention and tree rows in `v2/src/tui/tui-ink-monitor.tsx`; preserve Queue after the tree and add no spacer rows.
- Include the Work heading in `leftPaneTreeMaxVisibleRows` while retaining the zero floor and the complete `fullTreeRows` model.
- Add focused pure-builder tests in `v2/src/tui/tui-monitor-lines.test.ts` and an Ink consumer test in `v2/src/tui/tui-ink-monitor.test.tsx`.
- Add in-body `// @mutate` directives for the Work-heading consumer, empty-Work suppression, Work reservation, and zero floor.
- Update durable docs listed below.

## Acceptance criteria

- [ ] `tui-monitor-lines.test.ts` test `renders ruled Work and Queue headings only for non-empty sections` fails against the pre-fix code and proves Work reports the full tree's depth-zero node count, Queue reports its queued-row count, either empty section paints no heading, and queued rows remain oldest-first with the admission descriptor.
- [ ] `tui-monitor-lines.test.ts` test `lists every full-flatten work-tree row id in pane order` stays green; framing does not change the full tree or selection model.
- [ ] `tui-monitor-lines.test.ts` test `reserves every painted left-pane heading without a negative tree budget` fails against the pre-fix code and proves attention, Work, and Queue reservations reduce only the painted tree viewport and a pane shorter than the reservations yields zero painted tree rows.
- [ ] `tui-ink-monitor.test.tsx` test `renders ruled Work and Queue framing in the left pane` fails against the pre-fix code and proves the actual Ink consumer paints Needs attention, Work, and Queue in order with no blank spacer row.
- [ ] `tui-ink-monitor.test.tsx` — `renders ruled Work and Queue framing in the left pane`; Keystone checkpoint: an in-body `// @mutate` directive disables the Work-heading consumer and turns the scoped test red.
- [ ] `tui-monitor-lines.test.ts` — `renders ruled Work and Queue headings only for non-empty sections`; Mutation checkpoint: an in-body `// @mutate` directive inverts empty-Work suppression and turns the scoped test red.
- [ ] `tui-monitor-lines.test.ts` — `reserves every painted left-pane heading without a negative tree budget`; Mutation checkpoint: in-body `// @mutate` directives remove the Work-heading reservation and zero floor, and each turns the scoped test red.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` Observe section: describe ruled Work and Queue headings, their counts and empty-state omission, heading-only separation, and the Work-row reservation in the non-negative tree budget.
- `v2/docs/v1-behaviors.md`: update the existing TUI behavior entries to record ruled Work and Queue headings and the revised attention/Work/Queue budget.

## Implementer notes

- Give the Work-heading Ink integration a stable, unique one-line anchor; the keystone replacement must make that consumer produce no Work heading while leaving the test compilable.
- Target the real production condition for empty Work suppression and the real `Math.max(0, ...)` budget expression. Do not add test-only inversion hooks.
