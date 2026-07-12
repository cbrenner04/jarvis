# 00 - Testable keypress seam, bindings pinned

`openInkMonitor` gets `useInput` from `loadInkUi`, which only returns it on the real `ink` import path; the injected-render path used by tests returns none, so `tui-ink-monitor.tsx` falls back to a no-op handler and no test exercises a keypress. There is no `tui-ink-monitor` test file. Make the key handler reachable from tests and pin today's bindings, with no behavior change.

## Decisions

- The injected seam supplies the input hook alongside the renderer, so a test drives real keypresses through the same handler production uses; rejected exporting the handler as a bare function, which would not cover the composing state held in the component.
- No behavior changes here: same keys, same controls calls, same composing state machine.

## Task checklist

- [ ] Let tests inject a `useInput`-shaped hook through the existing ink-load seam.
- [ ] Add `tui-ink-monitor` tests driving keypresses through that hook.

## Acceptance criteria

- [ ] A test can render the monitor with an injected renderer and dispatch keypresses to the same input handler production `ink` drives; the production path still uses `ink`'s `useInput`.
- [ ] New `tui-ink-monitor` tests pin current bindings: `q` and Ctrl-C quit, `a` approves the selected run, `k` kills it, `v` opens the revise prompt, and while composing, typed characters accumulate, backspace/delete erase, Enter submits (empty buffer submits no prompt text), Escape cancels.
- [ ] While composing, `q`/`a`/`k` are consumed as prompt text and do not invoke their controls.
- [ ] `tui-entry.test.tsx` and `tui-monitor-lines.test.ts` stay green (no behavior change).

## Documentation updates

- None: internal test seam only, no operator-facing or architectural change. Keybinding docs land with the navigation subspec.
