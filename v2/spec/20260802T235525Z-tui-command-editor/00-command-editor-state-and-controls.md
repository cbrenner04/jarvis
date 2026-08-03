# 00 - Command editor state and controls

## Problem

The monitor has a dock buffer but no durable editor-state contract for focused editing.

## Decisions

- Keep command focus, buffer, and cursor in `TuiMonitorState`; mutate them only through `TuiMonitorControls` — rules out Ink-local editor state.
- `commandCursor` is a grapheme index. Insertions, Left/Right, Backspace, and Delete operate on whole graphemes and clamp at both buffer edges — rules out UTF-16-unit edits or wrapped-row navigation.
- Preserve focus, buffer, and cursor across monitor refreshes, including a focused nonempty buffer with a mid-buffer cursor.
- The control surface includes an inert submission handoff. It observes the current buffer only; it does not parse, dispatch, call RPC, show feedback, execute commands, or clear editor state. Operator-visible command dispatch belongs to follow-up work.
- Keep history, completion, Up/Down editor movement, and multiline editing out of scope.

## Work

- Extend monitor state and controls for command focus, insertion, cursor movement, deletion, and submission handoff.
- Wire the controls in `runTuiEntry` so state updates project to the dock and survive refreshes.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` adds the failing-before-change `edits command state through monitor controls` regression, proving retained focus/buffer/cursor, insertion at a grapheme cursor, multi-grapheme atomic insertion and cursor advancement, grapheme Left/Right, Backspace/Delete over multi-code-point clusters, edge clamping, and dock projection after every update.
- [ ] `tui-entry.test.tsx` adds the failing-before-change `retains focused command editor state across refresh` regression, starting from a nonempty mid-buffer editor and proving focus, buffer, cursor, and dock projection all survive refresh.
- [ ] `tui-entry.test.tsx` test `keeps submission handoff inert` proves a control submission receives its supplied buffer without parsing, RPC, feedback, command execution, or mutation of focus, buffer, or cursor.
- [ ] The exact `tui-entry.test.tsx` test `edits command state through monitor controls` carries unique valid `// @mutate` directives for each added or modified editor-state guard (grapheme boundary, cursor clamp, insertion, and deletion); each directive targets real production logic exactly once, turns that test RED, and has no production inversion hook. Negative-effect guards are pinned by assertions that the suppressed mutation is absent.

## Documentation updates

- None; routing documentation follows the observable input behavior in 01.

