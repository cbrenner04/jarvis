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

- [ ] `tui-entry.test.tsx` test `selection change issues no wait RPC` drives a selection change against a fake daemon client, asserts zero `wait` calls, and fails against the pre-fix code.
- [ ] `waitState` and `buildWaitStateForSelection` are gone from `tui-entry.tsx` and `tui-monitor-types.ts`; `bun run typecheck` proves no reader remains.
- [ ] `tui-monitor-lines.test.tsx` test `attributed run detail is resolved only from the selected durable row` stays green after `waitState` removal (steering feedback still renders after run detail).
- [ ] `tui-monitor-lines.test.tsx` test `right pane omits detail for runs outside the selectable window` fails against the current unwindowed fallback and passes after windowing.
- [ ] Mutation checkpoint: in `tui-monitor-lines.test.tsx` test `right pane omits detail for runs outside the selectable window`, a `// @mutate` directive reverting the fallback to the unwindowed run list turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — the right pane resolves detail only from selectable runs.
- `v2/docs/v1-behaviors.md` — record right-pane detail windowing to selectable runs.

## Prerequisites

- Fan-out order: first of `tui-remove-waitstate-window-detail` → `tui-dock-pipeline-steering` → `tui-dock-run-steering` → `tui-dock-log-follow`; `tui-unattributed-segment-retention-label` lands after this intent or in parallel on `tui-monitor-lines.ts`.
- `buildWaitStateForSelection` and `TuiMonitorState.waitState` exist on the monitor entry path.
- `monitorSelectableRuns` and `monitorSelectableNodeIds` exist in `tui-monitor-lines.ts`.
