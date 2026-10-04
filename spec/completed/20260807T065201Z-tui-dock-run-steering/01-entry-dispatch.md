# Entry dispatch

## Problem

Typed `kill`, `pause`, and `resume-run` are recognized parser verbs (after `00-command-parser`) but `submitCommand` has no dispatch for them, so they issue no run RPC. Keybind actions already reach `runSteeringAction` for pause, resume, and kill; the typed path must reach the same RPCs with pre-RPC eligibility guards.

## Prerequisites

- Subspec `00-command-parser` merged: `kill`, `pause`, and `resume-run` parse to zero-arg command kinds.
- `runSteeringAction` on the monitor entry path issues run `pause`/`resume`/`kill` RPCs for keybind actions (`runAction` → `getOwner(runId)` → `owner[method](runId)`).
- Daemon run `pause`/`resume`/`kill` RPCs are shipped and used by `jarvis run pause|resume|kill`.
- `jarvis tui` issues no `wait` RPC on selection change; the right pane resolves run detail only from selectable runs (merged `tui-remove-waitstate-window-detail`).
- Typed `approve`/`reject`/`resume` dock commands dispatch pipeline steering RPCs with named ineligible feedback (merged `tui-dock-pipeline-steering`).

## Decisions

- Typed `kill`/`pause`/`resume-run` dispatch through `runSteeringAction` on the selected run — rules out a second dispatch path parallel to keybindings.
- `resume-run` maps to `runSteeringAction("resume")` — matches the keybind resume action; the second `rewaitOnSuccess` argument was removed by `tui-remove-waitstate-window-detail`, so there is no wait to re-issue.
- Typed run steering does not use keybind `runAction`'s silent `runId === null` return; `submitCommand` runs a selection-shape guard before any live-run predicate or RPC.
- Selection-shape pre-RPC refusal reuses expansion-style `lastCommandResult` codes: `no_selection`, `unattributed`, `stale_non_expandable` for pipeline/stage and stale non-run selections; attributed tree run leaves pass.
- Kill and pause add a second pre-RPC guard using the kill-hint predicate (`isLive`, `isActiveRunStatus`, `actionableRunIds` when present); failure reports `not_live_run` on `lastCommandResult` and issues no RPC.
- `resume-run` pre-RPC eligibility matches keybind resume: selection-shape pass plus resolvable run id and owner; no kill-hint predicate — rules out pre-blocking killed or paused rows that keybind resume still attempts.
- Pre-RPC refusal uses `lastCommandResult` only; RPC outcomes and daemon policy refusals stay on `steeringFeedback` via `runSteeringAction` — rules out routing transport or daemon errors onto the dock status row.
- Typed `kill`, `pause`, and `resume-run` are not blocked by `commandSubmissionBlockedByPendingAdmission` — steering an existing run is orthogonal to detached pipeline `start` admission.
- Deferred to first consumer: buffer, cursor, and focus behavior after successful typed run steering.

## Work

- Add `runSteeringCommandSelectionError` (or equivalent) and wire typed dispatch in `tui-entry.tsx` `submitCommand` through `runSteeringAction`, with the selection-shape guard and verb-specific eligibility guards before RPC.
- Add entry regressions per Acceptance criteria; place `// @mutate` on the live-run eligibility guard in the ineligible-selection pin.

## Acceptance criteria

- [x] `tui-entry.test.tsx` test `typed kill pause and resume-run steer the selected live run` drives dispatch against a fake daemon client, issues one `pause`, `kill`, and `resume` RPC each on the selected live run, and fails against the pre-fix code.
- [x] `tui-entry.test.tsx` test `typed resume-run issues a resume RPC and no wait RPC` drives dispatch against a fake daemon client, asserts one `resume` run RPC on the selected live run and zero `wait` RPCs (wait was removed by `tui-remove-waitstate-window-detail`), and fails against the pre-fix code.
- [x] `tui-entry.test.tsx` test `typed run steering on ineligible selection reports feedback and issues no RPC` pins `lastCommandResult` codes and issues no run RPC for: pipeline/stage selection (`stale_non_expandable`), unattributed selection (`unattributed`), non-actionable retained row on `kill`/`pause` (`not_live_run`), and `resume-run` on a killed retained row (eligible — no pre-RPC refusal, contrasted with `kill`/`pause` on the same row).
- [x] Mutation checkpoint: in `tui-entry.test.tsx` test `typed run steering on ineligible selection reports feedback and issues no RPC`, a `// @mutate` directive inverting the live-run eligibility guard turns that regression RED.
- [x] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

None — operator and parity docs land in `02-docs`.
