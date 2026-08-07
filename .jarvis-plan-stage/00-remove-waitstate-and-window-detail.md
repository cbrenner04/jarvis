# Remove waitState and window right-pane detail

`waitState` is still polled on every selection change but nothing renders it after slice 4. The right-pane run fallback uses `monitorSelectableRuns`, which is wider than `monitorSelectableNodeIds`, so detail can show runs the left pane cannot select.

## Decisions

- Remove `waitState`, `buildWaitStateForSelection`, `TuiWaitState`, and all TUI monitor `wait` RPC (including initial selection) — rules out keeping a polled field with zero consumers or retaining open-time wait while dropping selection-change wait only.
- Window the right-pane unattributed-run fallback to ids in `monitorSelectableNodeIds` — rules out resolving run detail via the wider `monitorSelectableRuns` list.
- Pipeline and stage right-pane detail stay keyed to full-flatten tree rows (existing off-pane pipeline pin) — rules out re-windowing non-run detail in this slice.
- `state.steeringFeedback` is unchanged — rules out reading this as a cut to operator feedback.
- `resumeSelected` clears steering feedback on success but does not re-issue `wait` — rules out a resume-only wait path after monitor wait removal.
- Out of scope: left-pane retention rule and right-pane vertical scrolling.

## Prerequisites

- `buildWaitStateForSelection` and `TuiMonitorState.waitState` exist on the monitor entry path (`v2/src/tui/tui-entry.tsx`, `v2/src/tui/tui-monitor-types.ts`).
- `monitorSelectableRuns` and `monitorSelectableNodeIds` exist in `v2/src/tui/tui-monitor-lines.ts`.
- Fan-out order: first of `tui-remove-waitstate-window-detail` → `tui-dock-pipeline-steering` → `tui-dock-run-steering` → `tui-dock-log-follow`; `tui-unattributed-segment-retention-label` lands after this intent or in parallel on `tui-monitor-lines.ts`.

## Tasks

- Delete `buildWaitStateForSelection`, `startWaitForRun`, wait-token bookkeeping, and every `waitState` write from `tui-entry.tsx`; drop selection-time and post-resume `owner.wait` calls.
- Remove `waitState` from `TuiMonitorState` and delete `TuiWaitState` from `tui-monitor-types.ts`; update `TuiMonitorControls` resume doc-comment.
- Strip `waitState` from monitor fixtures and helpers across TUI tests; remove or rewrite entry tests that asserted wait polling, pending/ready/error waitState transitions, or `wait:` RPC on open/selection/resume.
- Add `tui-entry.test.tsx` pin `selection change issues no wait RPC`: open monitor with at least two selectable runs, change selection via injected controls, assert zero `wait` RPCs for the whole test (reachable on main via selection-driven `setSelection` → `startWaitForRun`).
- Gate `unwrappedRightPaneSegmentRows` run-id fallback: resolve durable-run detail only when `selected` is a run id present in `monitorSelectableNodeIds(state, nowMs)` (tree run leaf or unattributed row); omit detail otherwise.
- Add `tui-monitor-lines.test.tsx` pin `right pane omits detail for runs outside the selectable window`: fixture with `selectedNodeId` for a run in `state.runs` reachable via unwindowed `monitorSelectableRuns` but absent from `monitorSelectableNodeIds`; assert no durable-run detail rows (fails against pre-fix unwindowed fallback on main).
- Place `// @mutate` in that pin reverting the windowed fallback to `monitorSelectableRuns(state).find((run) => run.runId === selected)?.runId`.
- Update `attributed run detail is resolved only from the selected durable row`: drop `waitState` fixture fields and the wait-row `@mutate`; keep steering-feedback coverage.
- Update `v2/docs/operator-runbook.md` § Observe and `v2/docs/v1-behaviors.md` § TUI / observability.
- Run `bun run typecheck`, `bun run check`, and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` test `selection change issues no wait RPC` drives a selection change against a fake daemon client, asserts zero `wait` calls, and fails against the pre-fix code.
- [ ] `waitState` and `buildWaitStateForSelection` are gone from `tui-entry.tsx` and `tui-monitor-types.ts`; `bun run typecheck` proves no reader remains.
- [ ] `tui-monitor-lines.test.tsx` test `attributed run detail is resolved only from the selected durable row` stays green after `waitState` removal (steering feedback still renders after run detail).
- [ ] `tui-monitor-lines.test.tsx` test `right pane omits detail for runs outside the selectable window` fails against the current unwindowed fallback and passes after windowing.
- [ ] Mutation checkpoint: in `tui-monitor-lines.test.tsx` test `right pane omits detail for runs outside the selectable window`, a `// @mutate` directive reverting the fallback to the unwindowed run list turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — right-pane durable-run detail resolves only for runs the left pane can select (`monitorSelectableNodeIds`); no monitor `wait` polling.
- `v2/docs/v1-behaviors.md` § TUI / observability — record right-pane run detail windowing to selectable runs and removal of TUI monitor `wait` RPC.
