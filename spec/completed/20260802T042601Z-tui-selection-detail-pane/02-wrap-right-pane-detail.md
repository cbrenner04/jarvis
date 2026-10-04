# 02 - Wrap right-pane detail

## Problem

Complete detail can exceed the right pane and is currently truncated or width-unbounded.

## Decisions

- This slice follows 00 and 01 and wraps their complete ordered renderer output.
- Wrap the pure `monitorRightPaneSegmentRows` result after ordered detail assembly. “Complete detail” means that renderer returns every ordered row; the height-clipped Ink pane may not display every row because scrolling remains out of scope.
- Use effective positive render width: in split layout, `max(1, layout.rightWidth)`; in stacked layout, `max(1, terminalColumns)`. It is measured in terminal display columns, not JavaScript string length.
- Hard-wrap at that width without ellipsis. Preserve every character's order and each fragment's original segment tone; combining marks consume zero columns and wide terminal glyphs consume two.
- Keep selection projection, command dispatch, steering behavior, and pane scrolling unchanged.

## Work

- Wrap right-pane rows in `v2/src/tui/tui-monitor-lines.ts` at the effective positive display-column width.
- Extend `v2/src/tui/tui-monitor-lines.test.ts` with split, stacked, and extremely narrow lossless-wrap pins.
- Align the durable TUI brief, operator runbook, and v1-parity catalog.

## Acceptance criteria

- [x] Every pure right-pane output row fits the effective positive render width in split, stacked, and extremely narrow layouts. Long ids, paths, serialized artifacts, failures, and errors continue in order across rows without `…`; rejoining fragments restores the complete value and original segment tones.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` adds a long-value regression that fails against the 01 baseline and passes after this slice, proving display-column (including wide and combining characters), lossless, ellipsis-free wrapping in split, stacked, and one-column effective-width layouts.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` carries `// @mutate v2/src/tui/tui-monitor-lines.ts "wrapMonitorRows(rows, effectiveRightPaneWidth(layout, columns))" -> "rows"`; the wrapping pin turns red under the mutation.
- [x] The production guard delta in this slice is limited to layout-mode width selection and the positive-width floor. `v2/src/tui/tui-monitor-lines.test.ts` carries a uniquely targeted `// @mutate` directive for each; the stacked and extremely narrow pins turn red, with no production invert hooks.
- [x] `v2/spec/tui-overhaul-brief.md` marks the shipped selection-detail behavior and removes its stale missing-detail claim.
- [x] `v2/docs/operator-runbook.md` § Observe describes pipeline context, stage detail, selected-run detail, and width-bounded lossless rows by selection kind.
- [x] `v2/docs/v1-behaviors.md` records the additive v2 selection-keyed detail behavior and selected-row outcome source.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/spec/tui-overhaul-brief.md` — mark detail-pane selection content shipped and remove the stale missing-detail claim.
- `v2/docs/operator-runbook.md` § Observe — describe pipeline context plus selection-specific stage/run diagnostics and lossless wrapping.
- `v2/docs/v1-behaviors.md` — record the additive v2 selection-keyed detail behavior and selected-row outcome source.
