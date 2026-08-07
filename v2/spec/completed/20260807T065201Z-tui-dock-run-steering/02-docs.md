# Docs

## Problem

Once `kill`/`pause`/`resume-run` are live typed dock verbs, the operator runbook still lists them as CLI-fallback (`recognized_unavailable`) rows, and `v2/docs/v1-behaviors.md` does not record in-TUI typed run steering.

## Prerequisites

- Subspecs `00-command-parser` and `01-entry-dispatch` merged: `kill`/`pause`/`resume-run` parse and dispatch through `runSteeringAction`.

## Decisions

- The runbook Dock-commands table lists `kill`/`pause`/`resume-run` as live verbs and drops their CLI-fallback rows — rules out stale unavailable pointers for verbs this slice ships. `log` stays a CLI-fallback row until `tui-dock-log-follow`.
- `v2/docs/v1-behaviors.md` records in-TUI typed run steering (`kill`, `pause`, `resume-run`) as v2 behavior.

## Work

- Update `v2/docs/operator-runbook.md` § Observe / Dock commands: add `kill`/`pause`/`resume-run` live verbs; remove their CLI-fallback rows; keep `log`.
- Update `v2/docs/v1-behaviors.md` with in-TUI typed run steering.

## Acceptance criteria

- [x] The runbook Dock-commands table lists `kill`, `pause`, and `resume-run` as live dock verbs and no longer lists their CLI-fallback rows; `log` remains listed as CLI-fallback.
- [x] `v2/docs/v1-behaviors.md` records in-TUI typed run steering (`kill`, `pause`, `resume-run`).
- [x] `bun run lint:md` passes.

## Documentation updates

This subspec is the documentation update for the slice.
