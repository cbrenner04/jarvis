---
name: tui-remove-waitstate-window-detail
---

# Remove wait polling and window detail to selectable runs

## Problem

`waitState` is still polled on every selection change but nothing renders it after slice 4. The right-pane run fallback uses `monitorSelectableRuns`, which is wider than `monitorSelectableNodeIds`, so detail can show runs the left pane cannot select.

## Decisions

- Remove `waitState`, `buildWaitStateForSelection`, and selection-driven `wait` RPC from `jarvis tui` — rules out keeping a polled field with zero consumers.
- Window the right-pane run fallback to the same set `monitorSelectableNodeIds` walks — rules out two notions of which runs exist in one pane pair.
- Steering feedback (`state.steeringFeedback`) is unaffected — rules out reading this as a cut to operator feedback.
- Out of scope: left-pane retention rule itself and right-pane vertical scrolling.

## Acceptance criteria

- [ ] `jarvis tui` issues no `wait` RPC on selection change; a test drives a selection change against a fake daemon client and asserts zero `wait` calls.
- [ ] `waitState` and `buildWaitStateForSelection` are gone from `tui-entry.tsx` and `tui-monitor-types.ts`; `bun run typecheck` proves no reader remains.
- [ ] Steering feedback still renders after run detail; a regression covers it.
- [ ] A run outside the left pane's retention window renders `No run selected.`-equivalent detail rather than full run detail; a regression fails against the current unwindowed fallback.
- [ ] Mutation checkpoint: in the pinning test for the windowed fallback, a `// @mutate` directive reverting the fallback to the unwindowed run list turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — the right pane resolves detail only from selectable runs.

## Prerequisites

- `buildWaitStateForSelection` and `TuiMonitorState.waitState` exist on the monitor entry path.
- `monitorSelectableRuns` and `monitorSelectableNodeIds` exist in `tui-monitor-lines.ts`.
