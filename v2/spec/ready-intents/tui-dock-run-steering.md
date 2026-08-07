---
name: tui-dock-run-steering
---

# Typed dock run steering

## Problem

`kill` and `pause` report `recognized_unavailable` naming CLI equivalents; `resume-run` returns `unknown_verb`, even though keybind actions already reach `runSteeringAction` for pause/resume/kill.

## Decisions

- Register `resume-run` as a parser verb distinct from pipeline `resume` — rules out leaving it `unknown_verb` or overloading pipeline `resume`.
- `kill`/`pause`/`resume-run` become real dock commands that reuse the existing `runSteeringAction` seam on the selected live run — rules out a second dispatch path parallel to keybindings.
- Ineligible selections report named dock feedback and issue no RPC — rules out silent no-ops.
- Remove `kill` and `pause` from `recognized_unavailable` and the runbook CLI-fallback table — rules out stale unavailable pointers after dispatch ships.

## Acceptance criteria

- [ ] `tui-command-parser.test.ts` test `parses resume-run as a run-steering verb` fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `typed kill pause and resume-run steer the selected live run` reaches `runSteeringAction` (one run RPC each) and fails against the pre-fix code; ineligible selection reports named feedback and issues no RPC.
- [ ] The parser maps `resume-run` to a run-steering command; `kill` and `pause` no longer map to `recognized_unavailable`; the runbook Dock-commands table lists `kill`/`pause`/`resume-run` as live verbs and drops their CLI-fallback rows.
- [ ] Mutation checkpoint: in `tui-entry.test.tsx` test `typed run steering on ineligible selection reports feedback and issues no RPC`, a `// @mutate` directive inverting the live-run eligibility guard turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — `kill`/`pause`/`resume-run` are live dock verbs.
- `v2/docs/v1-behaviors.md` — record in-TUI run steering.

## Prerequisites

- Fan-out order: lands after `tui-dock-pipeline-steering`, before `tui-dock-log-follow`.
- Command parser and dock dispatch exist (`tui-command-parser.ts`, `tui-entry.tsx`).
- `runSteeringAction` on the monitor entry path issues run `pause`/`resume`/`kill` RPCs for keybind actions.
- Daemon run `pause`/`resume`/`kill` RPCs are shipped and used by `jarvis run pause|resume|kill`.
- `jarvis tui` issues no `wait` RPC on selection change.
- The right pane resolves run detail only from selectable runs.
- Typed `approve`/`reject`/`resume` dock commands dispatch pipeline steering RPCs with named ineligible feedback.
