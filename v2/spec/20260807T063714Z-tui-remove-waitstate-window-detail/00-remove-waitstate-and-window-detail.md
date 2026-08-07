# Remove waitState and window right-pane detail

`waitState` is still polled on every selection change but nothing renders it after slice 4. The right-pane run fallback uses `monitorSelectableRuns`, which is wider than `monitorSelectableNodeIds`, so detail can show runs the left pane cannot select.

## Decisions

- Remove `waitState`, `buildWaitStateForSelection`, `TuiWaitState`, and all TUI monitor `wait` RPC (open-time, selection change, owner reconnect, post-resume) — rules out keeping a polled field with zero consumers or retaining any monitor wait path while dropping selection-change wait only.
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

- Delete `buildWaitStateForSelection`, `startWaitForRun`, wait-token bookkeeping, and every `waitState` write from `tui-entry.tsx`; drop every `owner.wait` call (open, selection change, owner reconnect, post-resume).
- Remove `waitState` from `TuiMonitorState` and delete `TuiWaitState` from `tui-monitor-types.ts`; update `TuiMonitorControls` resume doc-comment.
- Strip `waitState` from monitor fixtures and helpers across TUI tests; remove or rewrite entry tests that asserted wait polling, pending/ready/error waitState transitions, or `wait:` RPC on open/selection/reconnect/resume.
- Add `tui-entry.test.tsx` pin `monitor session issues no wait RPC`: open monitor with at least two selectable runs (open alone issues `wait` on main), change selection via injected controls, assert zero `wait` RPCs for the whole session against a fake daemon client; owner-reconnect re-wait coverage desirable.
- Add `tui-entry.test.tsx` pin `successful resume does not re-issue wait`: after open, drive `resumeSelected` on the selected run and assert no additional `wait` calls (replaces `successful resume re-issues wait and abandons a prior ready snapshot`).
- Gate `unwrappedRightPaneSegmentRows` run-id fallback: resolve durable-run detail only when `selected` is a run id present in `monitorSelectableNodeIds(state, nowMs)` (tree run leaf or unattributed row); omit detail otherwise.
- Add `tui-monitor-lines.test.ts` pin `right pane omits detail for runs outside the selectable window`: fixture with `selectedNodeId` for a run in `state.runs` reachable via unwindowed `monitorSelectableRuns` but absent from `monitorSelectableNodeIds`; assert no durable-run detail rows (fails against pre-fix unwindowed fallback on main).
- Place `// @mutate` in that pin inverting the post-fix `monitorSelectableNodeIds` membership guard on the unique fallback line in `unwrappedRightPaneSegmentRows` (e.g. `selectableIds.includes(selected)` -> `true`) so reverting windowing turns the regression RED.
- Update `attributed run detail is resolved only from the selected durable row`: drop `waitState` fixture fields and the wait-row `@mutate`; keep steering-feedback coverage.
- Update `v2/docs/operator-runbook.md` § Observe and dock copy, `v2/docs/v1-behaviors.md` § TUI / observability, `v2/docs/write-behavior.md` monitor/outcome copy, and `v2/docs/first-workflow-walkthrough.md` Outcome-from-wait prose.
- Run `bun run typecheck`, `bun run check`, and `bun run test:v2`.

## Acceptance criteria

- [x] `tui-entry.test.tsx` test `monitor session issues no wait RPC` opens the monitor and changes selection against a fake daemon client, asserts zero `wait` calls for the whole session, and fails against the pre-fix code (open alone issues `wait` on main).
- [x] `tui-entry.test.tsx` test `successful resume does not re-issue wait` drives `resumeSelected` after open and asserts no additional `wait` calls, failing against pre-fix `successful resume re-issues wait and abandons a prior ready snapshot` behavior reachable on main.
- [x] Legacy monitor wait-polling entry tests (`selecting a quiescent run waits for that run and shows only present optional outcome fields`, `changing selection while wait is pending abandons the prior wait and starts a fresh one`, `a reconnected owner socket re-issues the selected run's wait exactly once`, `late replies from abandoned waits are ignored`, `wait failure with unchanged selection shows error state not perpetual pending`, `waitState error display is unchanged by steering feedback`, wait-state-on-refresh pins, and `successful resume re-issues wait and abandons a prior ready snapshot`) are removed or rewritten; `bun run test:v2` passes with no monitor-path `wait` RPC assertions.
- [x] `waitState` and `buildWaitStateForSelection` are gone from `tui-entry.tsx` and `tui-monitor-types.ts`; `bun run typecheck` proves no reader remains.
- [x] `tui-monitor-lines.test.ts` test `attributed run detail is resolved only from the selected durable row` stays green after `waitState` removal (steering feedback still renders after run detail).
- [x] `tui-monitor-lines.test.ts` test `right pane omits detail for runs outside the selectable window` fails against the current unwindowed fallback and passes after windowing.
- [x] Mutation checkpoint: in `tui-monitor-lines.test.ts` test `right pane omits detail for runs outside the selectable window`, a `// @mutate` directive inverting the post-fix `monitorSelectableNodeIds` membership guard turns that regression RED.
- [x] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe and dock copy — right-pane durable-run detail resolves only for runs the left pane can select (`monitorSelectableNodeIds`); no monitor `wait` polling; drop runs that “cannot be … waited on.”
- `v2/docs/v1-behaviors.md` § TUI / observability — record right-pane run detail windowing to selectable runs and removal of TUI monitor `wait` RPC.
- `v2/docs/write-behavior.md` — remove outcome panel, selection-driven `wait`, and resume re-wait; document monitor right-pane detail from selectable runs only.
- `v2/docs/first-workflow-walkthrough.md` — drop Outcome-from-daemon-`wait` copy for the monitor path.

## Blocker

Artifact contract check failed: Unparseable mutation checkpoints:
- criterion: Mutation checkpoint: in `tui-monitor-lines.test.ts` test `right pane omits detail for runs outside the selectable window`, a `// @mutate` directive inverting the post-fix `monitorSelectableNodeIds` membership guard turns that regression RED.; reference: tui-monitor-lines.test.ts; reason: unresolved_pinning_test
