# Daemon

## Problem

`approve`, `reject`, and `resume` are recognized dock verbs but only report `recognized_unavailable` naming CLI equivalents. Operators cannot steer pipeline gates or resume a pipeline from inside `jarvis tui`.

## Prerequisites

- Fan-out order: implement only after merged `tui-remove-waitstate-window-detail`; before `tui-dock-run-steering` and `tui-dock-log-follow`.
- Command parser and dock dispatch exist (`tui-command-parser.ts`, `tui-entry.tsx`).
- Daemon RPCs `pipeline_approve`, `pipeline_reject`, and `pipeline_resume` are shipped and used by `jarvis pipeline approve|reject|resume`.
- Dock status row reports admitted pipeline id or daemon refusal for `start`.
- `jarvis tui` issues no `wait` RPC on selection change.
- The right pane resolves run detail only from selectable runs.

## Decisions

- `approve`/`reject` resolve the selected tree row to an `awaiting` stage in the current `pipeline_list` snapshot and issue `pipeline_approve`/`pipeline_reject` with `{ pipelineId, stageId, branchKey }` — rules out targeting a pipeline row, a non-awaiting stage, or omitting `branchKey`.
- `resume` resolves the selected tree row to a non-terminal pipeline and issues one `pipeline_resume` with `{ pipelineId }` — rules out run-level `resume` RPC or resuming terminal pipelines.
- Eligible pipeline mutations use the owning daemon client discovered on refresh (same socket map as `list`/`pipeline_list`) — rules out always routing through the invoking socket.
- Successful mutations report the admitted pipeline id on `lastCommandResult`, clear buffer/cursor, and restore tree focus — rules out a second feedback channel or leaving command focus after success.
- Daemon refusals retain command focus/buffer/cursor and project refusal text verbatim on `lastCommandResult` — rules out rewriting daemon reasons or clearing repairable input.
- Ineligible selections report stable feedback codes on `lastCommandResult`, retain command focus/buffer/cursor, and issue no RPC:
  - shared: `no_selection`, `run_leaf`, `unattributed`, `stale_non_targetable`
  - approve/reject only: `not_awaiting_stage`
  - resume only: `not_pipeline`, `terminal_pipeline`
- Parser regression coverage lives in `tui-command-parser.test.ts`; dispatch and eligibility coverage live in `tui-entry.test.tsx` — rules out ink-rendered assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Work

- Extend `TuiCommand` / `parseTuiCommand` for `approve`, `reject`, and `resume`.
- Add pipeline-steering eligibility helpers and async dispatch in `tui-entry.tsx` `submitCommand`, mirroring `start` settlement semantics for success/failure feedback and stale-settlement suppression.
- Extend `TuiDaemonClient` (and test `fakeClient`) with `pipeline_approve`, `pipeline_reject`, and `pipeline_resume` RPC seams.
- Add focused parser, happy-path, ineligible, and mutation-checkpoint tests named in the acceptance criteria.
- Update operator and parity docs.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` test `typed approve issues pipeline_approve for the selected awaiting stage` drives dispatch against a fake daemon client, asserts the RPC and `(stageId, branchKey)` args, and fails against the pre-fix code; ineligible selection reports named feedback and issues no RPC.
- [ ] `tui-entry.test.tsx` test `typed reject issues pipeline_reject for the selected awaiting stage` drives dispatch against a fake daemon client, asserts the RPC and args, and fails against the pre-fix code; ineligible selection reports named feedback and issues no RPC.
- [ ] `tui-entry.test.tsx` test `typed resume issues pipeline_resume for the selected non-terminal pipeline` drives dispatch against a fake daemon client, asserts one `pipeline_resume`, and fails against the pre-fix code; ineligible selection reports named feedback and issues no RPC.
- [ ] Mutation checkpoint: in `tui-entry.test.tsx` test `typed approve on ineligible selection reports feedback and issues no RPC`, a `// @mutate` directive inverting the approve eligibility guard turns that regression RED; in test `typed resume on ineligible selection reports feedback and issues no RPC`, a `// @mutate` directive inverting the resume eligibility guard turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. TUI behavior is proven through production monitor state and the injected input hook, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe / Dock commands — `approve`/`reject`/`resume` are live dock verbs with eligibility and outcome semantics; correct the Shift+Enter claim.
- `v2/docs/v1-behaviors.md` — record in-TUI pipeline steering.
