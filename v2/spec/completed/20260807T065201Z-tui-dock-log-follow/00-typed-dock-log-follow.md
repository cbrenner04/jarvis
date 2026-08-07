# Typed dock log follow

## Problem

`log` is a recognized dock verb but only reports `recognized_unavailable` pointing at `jarvis tui log`. Operators cannot open a run log tail from inside the monitor.

## Prerequisites

- Fan-out order: lands after `tui-dock-run-steering` (last of the `tui-entry.tsx` / `tui-command-parser.ts` steering chain).
- `runTuiLogFollow` and the `jarvis tui log <run-id>` CLI path are shipped (`tui-log-follow-entry.tsx`, `commands/tui.ts`).
- Typed `approve`/`reject`/`resume` and typed `kill`/`pause`/`resume-run` dock commands are live on the merged base (parser verbs removed from `recognized_unavailable`, dispatch wired in `tui-entry.tsx`).

## Decisions

- `log` parses to `{ kind: "log" }` with no operands; trailing tokens return `unexpected_arguments` — rules out `log <run-id>` or ignored arguments.
- `log` dispatches through injected `runTuiLogFollow` with the same `socketPath` and `socketDiscovery` seams `jarvis tui log <run-id>` passes — rules out a second tail path or CLI subprocess.
- Eligibility requires `selectedRunIdFromState` non-null (attributed run leaf or unattributed run in `state.runs`); pipeline/stage selection is ineligible — rules out opening follow for non-run nodes.
- Ineligible `log` reports pinned `lastCommandResult` codes, retains command focus/buffer/cursor, and does not call `runTuiLogFollow` — rules out silent no-ops or the `steeringFeedback` channel: `no_selection` when `selectedRunIdFromState` is null with no run context; `not_a_run` when `selectedNodeId` is set but `selectedRunIdFromState` is null.
- Eligible `log` tears down the monitor session (same teardown `runTuiEntry` performs for production ink), then enters in-process log follow via `runTuiLogFollow`; the operator does not return to the monitor — quitting follow exits `jarvis tui`, matching `jarvis tui log <run-id>` — rules out a transient overlay, embedded pane, or monitor-embedded tail UI.
- Remove `log` from `UNAVAILABLE_COMMANDS` / `recognized_unavailable` and the runbook CLI-fallback table — rules out stale unavailable pointers after dispatch ships.

## Work

- Extend `TuiCommand` and `parseTuiCommand` for `log`; drop `log` from `UNAVAILABLE_COMMANDS`.
- Wire `submitCommand` `log` dispatch: eligibility guard, `runTuiLogFollow` on `RunTuiEntryDeps`, monitor teardown before follow entry when production ink is used.
- Add `tui-command-parser.test.ts` regression per Acceptance criteria.
- Add `tui-entry.test.tsx` coverage: happy path with injected `runTuiLogFollow` spy, `no_selection` when nothing is selected, `not_a_run` on pipeline/stage selection, and `// @mutate` on the run-leaf eligibility guard.
- Update `v2/docs/operator-runbook.md` § Observe / Dock commands and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `tui-entry.test.tsx` test `typed log opens log follow when selectedRunIdFromState is set` drives dispatch through injected `runTuiLogFollow` with the selected run id and the same tail deps `jarvis tui log <run-id>` uses; fails against the pre-fix code.
- [x] `tui-entry.test.tsx` test `typed log with no run selected reports no_selection and does not enter log follow` asserts `lastCommandResult: "no_selection"`, retains command focus/buffer/cursor, and does not call `runTuiLogFollow`; fails against the pre-fix code.
- [x] `tui-entry.test.tsx` test `typed log on pipeline or stage selection reports not_a_run and does not enter log follow` asserts `lastCommandResult: "not_a_run"`, retains command focus/buffer/cursor, and does not call `runTuiLogFollow`; fails against the pre-fix code.
- [x] `tui-command-parser.test.ts` test `parses log as a dock verb` fails against the pre-fix code and passes after implementation: bare `log` returns `{ kind: "log" }` (no longer `recognized_unavailable`); trailing tokens (e.g. `log <run-id>`) yield `unexpected_arguments`.
- [x] The parser no longer maps `log` to `recognized_unavailable`; the runbook Dock-commands table lists `log` as a live verb and drops its CLI-fallback row.
- [x] Mutation checkpoint: in `tui-entry.test.tsx` test `typed log on pipeline or stage selection reports not_a_run and does not enter log follow`, a `// @mutate` directive inverting the run-leaf eligibility guard turns that regression RED.
- [x] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — `log` is a live dock verb opening in-process log follow for the selected run (`selectedRunIdFromState`); document `no_selection` and `not_a_run` ineligible feedback; remove its CLI-fallback row.
- `v2/docs/v1-behaviors.md` — record in-TUI log follow from the dock (monitor teardown, no return to monitor).
