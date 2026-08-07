# Daemon

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

- Register `resume-run` as a parser verb distinct from pipeline `resume` — rules out leaving it `unknown_verb` or overloading pipeline `resume`.
- Extend `TuiCommand` with `kill`, `pause`, and `resume-run` kinds; parser rejects trailing tokens with `unexpected_arguments` — rules out operand-bearing forms or silent acceptance of extra tokens.
- Remove only `kill` and `pause` from `recognized_unavailable`; `log` stays unavailable until `tui-dock-log-follow` — rules out stale unavailable pointers for verbs this slice ships.
- Typed `kill`/`pause`/`resume-run` dispatch through `runSteeringAction` on the selected run — rules out a second dispatch path parallel to keybindings.
- `resume-run` maps to `runSteeringAction("resume", true)` — rules out omitting the keybind resume re-wait behavior.
- Pre-RPC ineligibility uses the same live-run predicate as the `k` kill hint (`isLive`, `isActiveRunStatus`, and `actionableRunIds` when present) — rules out client pre-gating that disagrees with painted kill affordance or daemon-only rejection for typed commands.
- Ineligible typed run steering reports a stable `lastCommandResult` code and issues no run RPC — rules out silent no-ops or routing pre-RPC refusal through `steeringFeedback`.
- RPC outcomes and post-admission eligibility failures continue through `runSteeringAction`/`steeringFeedback` — rules out moving daemon errors onto the dock status row.
- Deferred to first consumer: buffer, cursor, and focus behavior after successful typed run steering — pin when dispatch lands and the command editor interaction is observable.


## Work

- Extend `tui-command-parser.ts` with `kill`, `pause`, and `resume-run` command kinds; drop `kill`/`pause` from `UNAVAILABLE_COMMANDS`.
- Wire typed dispatch in `tui-entry.tsx` `submitCommand` through `runSteeringAction` with a live-run eligibility guard before RPC.
- Add parser and entry regressions per Acceptance criteria; place `// @mutate` on the live-run eligibility guard in the ineligible-selection pin.
- Update operator runbook Dock commands and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `tui-command-parser.test.ts` test `parses resume-run as a run-steering verb` fails against the pre-fix code and passes after implementation.
- [ ] `tui-command-parser.test.ts` proves `kill` and `pause` return typed command kinds with `unexpected_arguments` when trailing tokens are present; `resume-run` rejects trailing tokens the same way.
- [ ] `tui-entry.test.tsx` test `typed kill pause and resume-run steer the selected live run` drives dispatch against a fake daemon client, reaches `runSteeringAction` (one `pause`, `kill`, and `resume` RPC each on the selected live run), and fails against the pre-fix code; ineligible selection reports named feedback and issues no RPC.
- [ ] Mutation checkpoint: in `tui-entry.test.tsx` test `typed run steering on ineligible selection reports feedback and issues no RPC`, a `// @mutate` directive inverting the live-run eligibility guard turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).


## Documentation updates

- `v2/docs/v1-behaviors.md` — record in-TUI typed run steering (`kill`, `pause`, `resume-run`).
