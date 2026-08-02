---
name: tui-command-editor
---

# TUI command focus and editing

## Problem

The injected input hook routes every key to tree controls. Operators cannot focus, edit, or submit the command buffer without triggering navigation or steering.

## Decisions

- Drive focus and buffer edits through monitor controls into `TuiMonitorState` — rules out ink-local editor state.
- `:` and `/` focus an empty or retained buffer without inserting the focus key — rules out command text prefixed by its activation shortcut.
- `Esc` returns focus to the tree and preserves the buffer — rules out destructive cancellation.
- While focused, printable input and cursor-edit keys belong to the editor before tree bindings — rules out `j`/`k`/`e` navigation, kill, or expansion during typing.
- `Enter` invokes a submit control with the current buffer — rules out parsing or RPC work inside the ink hook.
- Keep command history, completion, and multiline editing out of scope — rules out editor scope beyond buffer, cursor, focus, and submission.

## Acceptance criteria

- [ ] `:` and `/` through the injected input hook focus the command line; `Esc` unfocuses it without clearing its buffer.
- [ ] Focused printable keys, including `j`, `k`, `e`, and `q`, insert at the cursor and do not navigate, expand, kill, or quit.
- [ ] Cursor movement, backspace, and delete edit the monitor-state buffer at the cursor; the dock projection reflects each update.
- [ ] `Enter` while focused calls the submit control once with the current buffer; while unfocused it does not submit.
- [ ] Existing unfocused navigation, expansion, divider, kill, and quit input tests stay green.
- [ ] `tui-ink-monitor.test.tsx` contains a `// @mutate` directive targeting the real command-focus guard; routing tree keys while focused turns the focus test RED and no production inversion hook exists.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — document `:`/`/`, `Esc`, editing keys, and tree-key suppression while focused.
- `v2/docs/v1-behaviors.md` — record command focus and injected-input behavior.

## Prerequisites
