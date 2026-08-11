# Frame Work and reserve its viewport row

## Problem

The work tree has no section boundary. Adding one without reserving its row would overpaint the left pane and can stale scroll-follow assumptions.

## Decision ledger

- Paint `── Work (N) ──` before a non-empty work tree, where `N` is the number of depth-zero nodes in the complete display model. Rules out counting flattened descendants or deriving a second model that can drift.
- A non-empty complete model paints Work even when its clipped tree-row budget is zero; only an empty complete model suppresses Work. Rules out deriving heading visibility or its count from the viewport slice.
- Reserve one Work row with the existing painted attention and Queue reservations, flooring the tree budget at zero. Rules out overflow and negative slices.
- Use the same full model and reservation for rendering and scroll follow, so expansion or an off-pane selection stays visible in the clipped tree viewport. Rules out preserving selectable IDs while losing the selected painted row.
- Keep attention, Queue rows and ordering, selection, expansion, pane geometry, right pane, and dock unchanged. Rules out a layout or command-grammar rework.

## Task checklist

- Derive the Work heading from the complete work-tree model in `v2/src/tui/tui-monitor-lines.ts` and render it between attention and tree rows in `v2/src/tui/tui-ink-monitor.tsx` without a spacer.
- Update `leftPaneTreeMaxVisibleRows`, its existing attention/Queue reservation assertions, and all related in-body `// @mutate` directives to reserve attention, Work, and Queue independently while retaining the zero floor.
- Extend the existing scroll-follow coverage in `v2/src/tui/tui-entry.test.tsx` to exercise an expanded or scrolled tree after the Work reservation is applied.
- Add focused pure-builder and Ink consumer tests in `v2/src/tui/tui-monitor-lines.test.ts` and `v2/src/tui/tui-ink-monitor.test.tsx`.
- Add in-body `// @mutate` directives for the Work consumer, empty-Work suppression, each heading reservation, and the zero floor.
- Update durable docs listed below.

## Acceptance criteria

- [ ] `tui-monitor-lines.test.ts` test `renders ruled Work heading from the full work model` fails against the pre-fix code and proves the heading reports the complete model's depth-zero count, suppresses only for a genuinely empty model, and still paints when a non-empty model has zero visible tree rows.
- [ ] `tui-monitor-lines.test.ts` test `lists every full-flatten work-tree row id in pane order` stays green; Work framing leaves the complete tree and selection model unchanged.
- [ ] `tui-monitor-lines.test.ts` test `reserves every painted left-pane heading without a negative tree budget` fails against the pre-fix code and updates the existing attention/Queue-only assertions and directives to prove independent attention, Work, and Queue reservations, a zero floor, and a zero-row clipped tree below those reservations.
- [ ] `tui-entry.test.tsx` test `j, k, and off-pane selectNode keep the selected tree row in the painted viewport` stays green after it expands or scrolls a Work-framed tree whose reduced budget would otherwise put the selected row off pane.
- [ ] `tui-ink-monitor.test.tsx` test `renders ruled Work framing in the left pane` fails against the pre-fix code and proves the actual consumer places Needs attention then Work then tree rows with no blank spacer.
- [ ] `tui-ink-monitor.test.tsx` — `renders ruled Work framing in the left pane`; Keystone checkpoint: an in-body `// @mutate` directive disables the Work-heading consumer and turns the scoped test red.
- [ ] `tui-monitor-lines.test.ts` — `renders ruled Work heading from the full work model`; Mutation checkpoint: an in-body `// @mutate` directive inverts empty-Work suppression and turns the scoped test red, including its zero-visible-row case.
- [ ] `tui-monitor-lines.test.ts` — `reserves every painted left-pane heading without a negative tree budget`; Mutation checkpoint: in-body `// @mutate` directives independently remove attention, Work, and Queue reservations and the zero floor, and each turns the scoped test red.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` Observe section: describe the ruled Work heading, its complete-model count, empty-state omission, heading-only separation, and its reservation in the non-negative tree budget.
- `v2/docs/v1-behaviors.md`: update the existing TUI behavior entries for the Work heading and the revised attention/Work/Queue budget.

## Implementer notes

- Give the Work-heading Ink integration a stable, unique one-line anchor; its keystone must produce no Work heading while leaving the test compilable.
- Target the production empty-Work condition, each production reservation term, and the real `Math.max(0, ...)` expression. Do not add test-only inversion hooks.
