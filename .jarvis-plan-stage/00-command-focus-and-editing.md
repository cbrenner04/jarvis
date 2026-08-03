# 00 - Command focus and editing

## Problem

The Ink input hook sends command text to tree actions instead of the dock buffer.

## Decisions

- Store command focus, buffer, and cursor in `TuiMonitorState` and mutate them through `TuiMonitorControls` — rules out Ink-local editor state.
- Treat `commandCursor` as a grapheme index; Left/Right move one grapheme and Backspace/Delete remove one grapheme before/at the cursor, clamped at buffer edges — rules out UTF-16-unit editing or wrapped-row navigation.
- From tree focus, `:` and `/` focus the retained buffer without inserting or clearing text — rules out shortcut-prefixed commands or destructive refocus.
- `Esc` restores tree focus without clearing the buffer or moving its cursor — rules out destructive cancellation.
- While command-focused, consume printable input and editor keys before tree bindings; suppress navigation, expansion, divider, kill, and `q` quit actions — rules out monitor actions while typing.
- Keep Ctrl-C as a global quit chord while command-focused — rules out trapping the emergency exit in the editor.
- `Enter` calls the submit control once with the current buffer; the entry host performs no parsing, RPC, feedback, or buffer clearing here — rules out pulling command dispatch into editing.
- Keep history, completion, Up/Down editor movement, and multiline editing out of scope — rules out expanding the editor beyond focus, insertion, grapheme cursor edits, and submission.

## Work

- Extend the injected Ink key seam and monitor controls for command focus, insertion, cursor movement, deletion, and submission.
- Wire controls in `runTuiEntry` to update and project monitor state while retaining editor state across refreshes.
- Route command-focused input before existing tree bindings; keep unfocused bindings and Ctrl-C behavior intact.
- Align dock hints and focused/unfocused input tests with the shipped editor behavior.
- Update the operator runbook and v1 behavior catalog in their durable homes.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` adds command-control regressions that fail against the pre-change baseline and prove focus, retained buffer/cursor, insertion at the cursor, grapheme Left/Right movement, Backspace/Delete, edge clamping, and dock projection after each state update.
- [ ] `tui-ink-monitor.test.tsx` proves `:` and `/` focus without insertion, `Esc` returns to tree focus without clearing, and `Enter` submits the current buffer exactly once only while command-focused.
- [ ] `tui-ink-monitor.test.tsx` proves focused printable `j`, `k`, `e`, `q`, `:`, `/`, `[`, and `]` edit the buffer without navigation, expansion, divider movement, kill, or quit; focused Up/Down do not navigate, while Ctrl-C still quits.
- [ ] `tui-monitor-lines.test.ts` proves tree hints advertise both focus shortcuts and command hints advertise `Esc` and `Enter` without multiline editing.
- [ ] `tui-ink-monitor.test.tsx` tests `drives row navigation through the injected input hook`, `drives workflow expansion through the injected input hook`, `drives quit and kill through the injected input hook`, and `[/] nudge divider offset through session state at 245×72` stay green for tree focus.
- [ ] `tui-ink-monitor.test.tsx` carries a unique valid `// @mutate` directive targeting the real command-focus routing guard; applying it routes tree keys while focused and turns the focused-input suppression test RED, and production has no inversion hook.
- [ ] `tui-entry.test.tsx` carries unique valid `// @mutate` directives for every added or modified editor-state guard; applying each mutation turns its pinning test RED, including negative cases that prove suppressed edits or effects remain absent, and production has no inversion hook.
- [ ] `v2/docs/operator-runbook.md` § Observe documents `:`/`/` focus, `Esc`, insertion and cursor-edit keys, submission handoff, Ctrl-C, and tree-key suppression while focused without claiming command dispatch.
- [ ] `v2/docs/v1-behaviors.md` records command focus, monitor-state editing, submission handoff, and focused input routing.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe.
- `v2/docs/v1-behaviors.md` `jarvis tui` entry.
