# TUI

## Problem

Typed `kill` and `pause` report `recognized_unavailable` naming CLI equivalents; `resume-run` returns `unknown_verb`, even though keybind actions already reach `runSteeringAction` for pause, resume, and kill.

## Prerequisites

- Fan-out order: lands after merged `tui-dock-pipeline-steering`, before `tui-dock-log-follow`. Do not start implement runs until upstream merges.
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
- `resume-run` maps to `runSteeringAction("resume")` — matches the keybind resume action; the second `rewaitOnSuccess` argument was removed by `tui-remove-waitstate-window-detail` (which this slice lands after), so there is no wait to re-issue.
- Typed run steering does not use keybind `runAction`'s silent `runId === null` return; `submitCommand` runs a selection-shape guard before any live-run predicate or RPC.
- Selection-shape pre-RPC refusal reuses expansion-style `lastCommandResult` codes: `no_selection`, `unattributed`, `stale_non_expandable` for pipeline/stage and stale non-run selections; attributed tree run leaves pass.
- Kill and pause add a second pre-RPC guard using the kill-hint predicate (`isLive`, `isActiveRunStatus`, `actionableRunIds` when present); failure reports `not_live_run` on `lastCommandResult` and issues no RPC.
- `resume-run` pre-RPC eligibility matches keybind resume: selection-shape pass plus resolvable run id and owner; no kill-hint predicate — rules out pre-blocking killed or paused rows that keybind resume still attempts.
- Pre-RPC refusal uses `lastCommandResult` only; RPC outcomes and daemon policy refusals stay on `steeringFeedback` via `runSteeringAction` — rules out routing transport or daemon errors onto the dock status row.
- Typed `kill`, `pause`, and `resume-run` are not blocked by `commandSubmissionBlockedByPendingAdmission` — steering an existing run is orthogonal to detached pipeline `start` admission.
- Deferred to first consumer: buffer, cursor, and focus behavior after successful typed run steering.

## Work

- Extend `tui-command-parser.ts` with `kill`, `pause`, and `resume-run` command kinds; drop `kill`/`pause` from `UNAVAILABLE_COMMANDS`.
- Add `runSteeringCommandSelectionError` (or equivalent) and wire typed dispatch in `tui-entry.tsx` `submitCommand` through `runSteeringAction` with selection-shape and verb-specific eligibility guards before RPC.
- Add parser and entry regressions per Acceptance criteria; place `// @mutate` on the live-run eligibility guard in the ineligible-selection pin.
- Update operator runbook Dock commands and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `tui-command-parser.test.ts` test `parses resume-run as a run-steering verb` fails against the pre-fix code and passes after implementation.
- [ ] `tui-command-parser.test.ts` test `parses kill and pause as run-steering verbs` fails against the pre-fix code (`recognized_unavailable`) and passes after implementation.
- [ ] `tui-command-parser.test.ts` proves `kill`, `pause`, and `resume-run` return typed command kinds with `unexpected_arguments` when trailing tokens are present.
- [ ] `tui-entry.test.tsx` test `typed kill pause and resume-run steer the selected live run` drives dispatch against a fake daemon client, issues one `pause`, `kill`, and `resume` RPC each on the selected live run, and fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `typed resume-run issues a resume RPC and no wait RPC` drives dispatch against a fake daemon client, asserts one `resume` run RPC on the selected live run and zero `wait` RPCs (wait was removed by `tui-remove-waitstate-window-detail`), and fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `typed run steering on ineligible selection reports feedback and issues no RPC` pins `lastCommandResult` codes and issues no run RPC for: pipeline/stage selection (`stale_non_expandable`), unattributed selection (`unattributed`), non-actionable retained row on `kill`/`pause` (`not_live_run`), and `resume-run` on a killed retained row (eligible — no pre-RPC refusal, contrasted with `kill`/`pause` on the same row).
- [ ] Mutation checkpoint: in `tui-entry.test.tsx` test `typed run steering on ineligible selection reports feedback and issues no RPC`, a `// @mutate` directive inverting the live-run eligibility guard turns that regression RED.
- [ ] The parser maps `resume-run` to a run-steering command; `kill` and `pause` no longer map to `recognized_unavailable`; the runbook Dock-commands table lists `kill`/`pause`/`resume-run` as live verbs and drops their CLI-fallback rows.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — `kill`/`pause`/`resume-run` are live dock verbs; remove their CLI-fallback rows.
- `v2/docs/v1-behaviors.md` — record in-TUI typed run steering (`kill`, `pause`, `resume-run`).
