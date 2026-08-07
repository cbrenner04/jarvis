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
- Eligibility requires `selectedRunIdFromState` non-null (selected run leaf or unattributed run); pipeline/stage selection is ineligible — rules out opening follow for non-run nodes.
- Ineligible `log` reports named feedback on `lastCommandResult`, retains command focus/buffer/cursor, and does not call `runTuiLogFollow` — rules out silent no-ops or the `steeringFeedback` channel.
- Eligible `log` enters log follow in-process via `runTuiLogFollow`; out of scope: a separate log pane layout or monitor-embedded tail UI — rules out new layout work.
- Remove `log` from `UNAVAILABLE_COMMANDS` / `recognized_unavailable` and the runbook CLI-fallback table — rules out stale unavailable pointers after dispatch ships.
- Deferred to first consumer: exact ineligible feedback code for pipeline/stage selection when `selectedNodeId` is set but `selectedRunIdFromState` is null — pin when the negative test is written.

## Work

- Extend `TuiCommand` and `parseTuiCommand` for `log`; drop `log` from `UNAVAILABLE_COMMANDS`.
- Wire `submitCommand` `log` dispatch: eligibility guard, `runTuiLogFollow` on `RunTuiEntryDeps`, monitor teardown before follow entry when production ink is used.
- Add `tui-command-parser.test.ts` regression that `log` returns `{ kind: "log" }` and no longer yields `recognized_unavailable`.
- Add `tui-entry.test.tsx` coverage: happy path with injected `runTuiLogFollow` spy, no-selection feedback, ineligible pipeline/stage feedback, and `// @mutate` on the run-leaf eligibility guard.
- Update `v2/docs/operator-runbook.md` § Observe / Dock commands and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` test `typed log opens log follow for the selected run leaf` drives dispatch through injected `runTuiLogFollow` with the selected run id and the same tail deps `jarvis tui log <run-id>` uses; fails against the pre-fix code; with no run selected it reports named feedback and does not enter log follow.
- [ ] The parser no longer maps `log` to `recognized_unavailable`; the runbook Dock-commands table lists `log` as a live verb and drops its CLI-fallback row.
- [ ] Mutation checkpoint: in `tui-entry.test.tsx` test `typed log on ineligible selection reports feedback and does not enter log follow`, a `// @mutate` directive inverting the run-leaf eligibility guard turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — `log` is a live dock verb opening in-process log follow for the selected run leaf; remove its CLI-fallback row.
- `v2/docs/v1-behaviors.md` — record in-TUI log follow from the dock.
