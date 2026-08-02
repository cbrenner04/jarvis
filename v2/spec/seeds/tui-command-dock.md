---
name: tui-command-dock
---

# TUI slice 5 — the command dock is four painted lines with no input

## Problem

The dock exists as geometry only. `renderDockContent` (`v2/src/tui/tui-ink-monitor.tsx:228-238`)
emits a hardcoded four-line block: an active-count/refresh status line, a bare `>` prompt, and two
empty lines. Nothing is typed into it, nothing is parsed, nothing is dispatched. There is no
command-line state on `TuiMonitorState` and no dock content function in `tui-monitor-lines.ts` —
unlike both panes, which are pure functions there.

So every pipeline still starts from a shell: the operator watches in `jarvis tui` and switches
terminals to run `jarvis pipeline start`. That is the split the brief
([tui-overhaul-brief.md](../tui-overhaul-brief.md) § Command dock) exists to close.

## Decisions

- Dock content becomes a **pure function** in `tui-monitor-lines.ts` over monitor state, the same
  shape as the two panes — rules out content CI cannot assert, and rules out a third rendering
  convention.
- Command state (buffer, cursor, focus, last result/error) lives on `TuiMonitorState` and is driven
  through the existing injected input hook — rules out an ink-owned input widget that tests cannot
  reach ([test-writing.md § TUI test strategy](../../docs/test-writing.md#tui-test-strategy)).
- `:` and `/` focus the command line; `Esc` returns focus to the tree; `Enter` submits. While the
  command line has focus, tree keybindings (`j`/`k`/`e`) do not fire — rules out a dock that eats
  navigation or a navigation layer that eats typing.
- Grammar is a **CLI mirror**, parsed by a pure tokenizer/parser that returns a typed command or a
  named parse error. This slice implements `start <project> [--seed <path> | --seed-text <text>]`
  and `expand` / `collapse` on the selection; every other verb parses to a recognized-but-
  unimplemented error naming slice 6 — rules out a parser that silently accepts what it cannot run.
- `start` runs the same pre-admission resolution and `pipeline_start` path the CLI uses, dispatched
  detached; the dock reports the admitted pipeline id or the daemon `reason` verbatim — rules out a
  second admission path, and rules out blocking the render loop on the RPC.
- Line 3 is the input continuation line for wrapped or pasted `--seed-text`; it collapses when
  empty — rules out a dock that changes height.
- Out of scope, named: approve/reject/resume, run pause/kill, log follow (all slice 6); command
  history; completion; post-start focus-and-reveal.

## Acceptance criteria

- [ ] Dock content is produced by a pure function over monitor state and covers all four lines:
      status (active count, daemon profile/socket digest, refresh interval, last RPC error when
      present), input with prompt and cursor, continuation, and selection-contextual hints.
- [ ] `:` and `/` focus the command line and `Esc` unfocuses it, driven through the injected input
      hook; while focused, `j`/`k`/`e` insert characters instead of moving the selection, and while
      unfocused they still navigate.
- [ ] The parser returns a typed command for `start jarvis --seed v2/spec/seeds/foo.md`,
      `start jarvis --seed-text "ship it"`, `expand`, and `collapse`, and a named error for an
      unknown verb, a missing project, both seed flags at once, and an unterminated quote.
- [ ] A recognized slice-6 verb (`approve`, `reject`, `resume`, `kill`, `pause`, `log`) parses to a
      distinct not-yet-implemented error naming the CLI equivalent, not to an unknown-verb error.
- [ ] Submitting `start` dispatches one detached `pipeline_start` through the same resolution the
      CLI uses and reports the admitted pipeline id; a daemon refusal reports its `reason` verbatim
      on the status line and leaves the buffer intact for editing.
- [ ] Text longer than one dock line renders on the continuation line, and the dock stays exactly
      four lines tall in both split and stacked layouts.
- [ ] Mutation checkpoint: inverting the focus guard so tree keys fire while the command line has
      focus turns the focus test RED, via a `// @mutate` directive in the pinning file.
- [ ] Mutation checkpoint: making the parser accept an unknown verb turns the parse-error test RED,
      via a `// @mutate` directive in the pinning file.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/spec/tui-overhaul-brief.md` — mark slice 5 shipped.
- `v2/docs/operator-runbook.md` § Observe — the dock grammar, focus keys, and what `start` does.

## Prerequisites

- `renderDockContent`, `createMonitorDisplay` (`v2/src/tui/tui-ink-monitor.tsx`)
- `TuiMonitorState`, `TuiMonitorControls`, the injected input hook (`v2/src/tui/tui-monitor-types.ts`,
  `v2/src/tui/tui-ink-runtime.ts`)
- `computeShellLayout` dock geometry (`v2/src/tui/tui-shell-layout.ts`)
- CLI pipeline-start pre-admission resolution (`v2/src/commands/pipeline.ts`)
