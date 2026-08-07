---
name: tui-dock-log-follow
---

# Typed dock log follow

## Problem

`log` is a recognized dock verb but only reports `recognized_unavailable` pointing at `jarvis tui log`. Operators cannot open a run log tail from inside the monitor.

## Decisions

- `log` opens the selected run's log follow in-process via the same entry `jarvis tui log <run-id>` drives — rules out leaving log-follow CLI-only.
- `log` requires a selected run leaf; pipeline/stage selection is ineligible with named feedback — rules out opening follow for non-run nodes.
- Out of scope: a separate log pane layout; reuse the existing follow entry.
- Ineligible selection reports named dock feedback and does not enter log follow — rules out silent no-ops.
- Remove `log` from `recognized_unavailable` and the runbook CLI-fallback table — rules out stale unavailable pointers after dispatch ships.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` test `typed log opens log follow for the selected run leaf` opens the same log-follow tail `jarvis tui log <run-id>` drives and fails against the pre-fix code; no run selected reports named feedback.
- [ ] The parser no longer maps `log` to `recognized_unavailable`; the runbook Dock-commands table lists `log` as a live verb and drops its CLI-fallback row.
- [ ] Mutation checkpoint: in `tui-entry.test.tsx` test `typed log on ineligible selection reports feedback and does not enter log follow`, a `// @mutate` directive inverting the run-leaf eligibility guard turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — `log` is a live dock verb.
- `v2/docs/v1-behaviors.md` — record in-TUI log follow from the dock.

## Prerequisites

- Fan-out order: lands after `tui-dock-run-steering` (last of the `tui-entry.tsx` / `tui-command-parser.ts` steering chain).
- Command parser and dock dispatch exist (`tui-command-parser.ts`, `tui-entry.tsx`).
- Log-follow entry (`tui-log-follow-entry.tsx`) and the `jarvis tui log <run-id>` path are shipped.
- `jarvis tui` issues no `wait` RPC on selection change.
- The right pane resolves run detail only from selectable runs.
- Typed `approve`/`reject`/`resume` dock commands dispatch pipeline steering RPCs with named ineligible feedback.
- Typed `kill`/`pause`/`resume-run` dock commands reach `runSteeringAction` with named ineligible feedback.
