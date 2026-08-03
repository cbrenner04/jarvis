# 01 - Command input routing and guidance

## Problem

The injected Ink input hook sends command text to tree actions instead of the dock buffer.

## Prerequisites

- 00 - Command editor state and controls is complete.

## Decisions

- From tree focus, `:` and `/` focus the retained buffer without inserting or clearing either shortcut.
- `Esc` restores tree focus without clearing the buffer or moving its cursor.
- While command-focused, editor routing precedes every tree binding. Printable unmodified input, including `j`, `k`, `e`, `q`, `:`, `/`, `[`, and `]`, inserts at the cursor; tree navigation, expansion, divider movement, kill, and quit are suppressed.
- Unmodified special keys are classified before insertion: Left/Right, Backspace, Delete, `Esc`, and `Enter` use editor behavior. Focused Enter, even for an empty buffer, calls the inert submission handoff exactly once with the current buffer and leaves focus, buffer, and cursor unchanged. Unfocused Enter does not submit.
- Ctrl-C remains the global quit chord and never inserts. Any other Ctrl- or Meta-modified input, including modified editor/tree keys, is ignored: it neither edits nor reaches tree controls. Shift+Enter is ignored; it neither submits nor inserts a newline.
- A paste without CR/LF inserts all its graphemes atomically and advances the cursor by their count. Pasted CR and LF are ignored; remaining graphemes insert atomically, so multiline editing is not introduced.
- Tree focus leaves command focus, buffer, and cursor unchanged for printable input, Left/Right, Backspace, and Delete, while existing tree bindings retain their current behavior.
- Dock guidance advertises both focus shortcuts in tree focus and only `Esc`/`Enter` command guidance in command focus; it must not advertise newline insertion.

## Work

- Extend the injected Ink key seam for command focus, editor routing, and inert submission handoff.
- Route focused input before tree bindings while retaining unfocused bindings and Ctrl-C behavior.
- Align dock hints and input tests with the editor contract.
- Update the operator runbook and v1 behavior catalog in their durable homes.

## Acceptance criteria

- [x] `tui-ink-monitor.test.tsx` adds the failing-before-change `routes command-focused editor input before tree bindings` regression: `:` and `/` focus without insertion; `Esc` returns to tree focus retaining buffer/cursor; focused printable `j`, `k`, `e`, `q`, `:`, `/`, `[`, and `]` edit without tree effects; focused Up/Down do not navigate; and Ctrl-C quits without insertion.
- [x] `tui-ink-monitor.test.tsx` test `submits only focused command input` proves focused Enter, including an empty buffer, calls the handoff once with the current buffer and leaves focus/buffer/cursor unchanged; unfocused Enter does not submit; Shift+Enter neither submits nor inserts a newline.
- [x] `tui-ink-monitor.test.tsx` test `classifies modified keys and paste before editor insertion` proves unmodified special keys take editor precedence, non-Ctrl-C Ctrl/Meta input has no editor or tree effect, multi-grapheme paste advances by grapheme count, and CR/LF paste inserts no newline.
- [x] `tui-ink-monitor.test.tsx` test `keeps command state unchanged in tree focus` proves tree-focused printable input, Left/Right, Backspace, and Delete leave command focus, buffer, and cursor unchanged.
- [x] `tui-monitor-lines.test.ts` adds the failing-before-change `shows contextual command-focus hints without multiline editing` regression proving tree hints advertise `:` and `/`, command hints advertise `Esc` and `Enter`, and neither hint advertises newline insertion.
- [x] `tui-ink-monitor.test.tsx` tests `drives row navigation through the injected input hook`, `drives workflow expansion through the injected input hook`, `drives quit and kill through the injected input hook`, and `[/] nudge divider offset through session state at 245×72` stay green for tree focus.
- [x] The exact `tui-ink-monitor.test.tsx` test `routes command-focused editor input before tree bindings` carries unique valid `// @mutate` directives for the real focus-routing guard, key-classification/insertion-precedence guard, Ctrl-C guard, and edit-suppression guard; each target occurs exactly once, its mutation turns that test RED, and production has no inversion hook. The negative-effect assertions prove suppressed tree effects remain absent.
- [x] The exact `tui-ink-monitor.test.tsx` test `submits only focused command input` carries unique valid `// @mutate` directives for the focused-Enter and unmodified-Shift+Enter guards; each target occurs exactly once, its mutation turns that test RED, and production has no inversion hook. The test proves absent submission where required.
- [x] The exact `tui-monitor-lines.test.ts` test `shows contextual command-focus hints without multiline editing` carries a unique valid `// @mutate` directive for each modified conditional hint guard; each target occurs exactly once, its mutation turns that test RED, and production has no inversion hook.
- [x] `v2/docs/operator-runbook.md` § Observe documents `:`/`/` focus, `Esc`, insertion and cursor-edit keys, inert submission handoff, Ctrl-C, CR/LF and Shift+Enter behavior, and tree-key suppression while focused without claiming command dispatch.
- [x] `v2/docs/v1-behaviors.md` records command focus, monitor-state editing, inert submission handoff, and focused injected-input routing.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe.
- `v2/docs/v1-behaviors.md` `jarvis tui` entry.
