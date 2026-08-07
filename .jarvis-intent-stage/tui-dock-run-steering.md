---
name: tui-dock-run-steering
---

# Typed dock run steering

## Problem

`kill`, `pause`, and `resume-run` are recognized dock verbs but only report `recognized_unavailable` naming CLI equivalents, even though keybind actions already reach `runSteeringAction` for pause/resume/kill.

## Decisions

- `kill`/`pause`/`resume-run` become real dock commands that reuse the existing `runSteeringAction` seam on the selected live run — rules out a second dispatch path parallel to keybindings.
- Ineligible selections report named dock feedback and issue no RPC — rules out silent no-ops.
- Remove these verbs from `recognized_unavailable` and the runbook CLI-fallback table — rules out stale unavailable pointers after dispatch ships.

## Acceptance criteria

- [ ] Typed `kill`/`pause`/`resume-run` over a selected live run reach the existing `runSteeringAction` seam (one run RPC each); ineligible selection reports named feedback and issues no RPC.
- [ ] The parser no longer maps `kill`, `pause`, or `resume-run` to `recognized_unavailable`; the runbook Dock-commands table lists them as live verbs and drops their CLI-fallback rows.
- [ ] Mutation checkpoint: for each new run-steering eligibility guard, a `// @mutate` directive inside its pinning test body inverting the eligibility check reddens the guard's regression.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — `kill`/`pause`/`resume-run` are live dock verbs.
- `v2/docs/v1-behaviors.md` — record in-TUI run steering.

## Prerequisites

- Command parser and dock dispatch exist (`tui-command-parser.ts`, `tui-entry.tsx`).
- `runSteeringAction` on the monitor entry path issues run `pause`/`resume`/`kill` RPCs for keybind actions.
- Daemon run `pause`/`resume`/`kill` RPCs are shipped and used by `jarvis run pause|resume|kill`.
- `jarvis tui` issues no `wait` RPC on selection change.
- The right pane resolves run detail only from selectable runs.
- Typed `approve`/`reject`/`resume` dock commands dispatch pipeline steering RPCs with named ineligible feedback.
