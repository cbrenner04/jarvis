# CLI

## Problem

Typed `kill` and `pause` report `recognized_unavailable` naming CLI equivalents; `resume-run` returns `unknown_verb`, even though keybind actions already reach `runSteeringAction` for pause, resume, and kill.

## Prerequisites

- Fan-out order: lands after merged `tui-dock-pipeline-steering`, before `tui-dock-log-follow`.
- Command parser and dock dispatch exist (`tui-command-parser.ts`, `tui-entry.tsx`).
- `runSteeringAction` on the monitor entry path issues run `pause`/`resume`/`kill` RPCs for keybind actions.
- Daemon run `pause`/`resume`/`kill` RPCs are shipped and used by `jarvis run pause|resume|kill`.
- `jarvis tui` issues no `wait` RPC on selection change (merged `tui-remove-waitstate-window-detail`).
- The right pane resolves run detail only from selectable runs (merged `tui-remove-waitstate-window-detail`).
- Typed `approve`/`reject`/`resume` dock commands dispatch pipeline steering RPCs with named ineligible feedback (merged `tui-dock-pipeline-steering`).

## Decisions

## Work

- Extend `tui-command-parser.ts` with `kill`, `pause`, and `resume-run` command kinds; drop `kill`/`pause` from `UNAVAILABLE_COMMANDS`.
- Wire typed dispatch in `tui-entry.tsx` `submitCommand` through `runSteeringAction` with a live-run eligibility guard before RPC.
- Add parser and entry regressions per Acceptance criteria; place `// @mutate` on the live-run eligibility guard in the ineligible-selection pin.
- Update operator runbook Dock commands and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] The parser maps `resume-run` to a run-steering command; `kill` and `pause` no longer map to `recognized_unavailable`; the runbook Dock-commands table lists `kill`/`pause`/`resume-run` as live verbs and drops their CLI-fallback rows.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — `kill`/`pause`/`resume-run` are live dock verbs; remove their CLI-fallback rows.