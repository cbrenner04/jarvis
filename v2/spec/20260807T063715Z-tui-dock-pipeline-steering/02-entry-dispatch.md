# Entry dispatch

## Problem

`approve`, `reject`, and `resume` are recognized dock verbs but only report `recognized_unavailable` naming CLI equivalents. Operators cannot steer pipeline gates or resume a pipeline from inside `jarvis tui`.

## Prerequisites

- Subspecs `00-command-parser` and `01-daemon-client` merged.
- Command parser and dock dispatch exist (`tui-command-parser.ts`, `tui-entry.tsx`).
- Dock status row reports admitted pipeline id or daemon refusal for `start`.
- `jarvis tui` issues no `wait` RPC on selection change.
- The right pane resolves run detail only from selectable runs.

## Decisions

- Selection resolution uses the currently selected tree row only — no ancestor walk-up (same model as `expand`/`collapse`):
  - `approve`/`reject` require an **awaiting** stage row; a pipeline parent row or non-awaiting stage yields `not_awaiting_stage`.
  - `resume` requires a **pipeline** row; a stage row yields `not_pipeline`; a run leaf yields `run_leaf`.
- `approve`/`reject` issue `pipelineApprove`/`pipelineReject` with `{ pipelineId, stageId, branchKey }` resolved from the selected awaiting stage in the current `pipeline_list` snapshot — rules out targeting a pipeline row, a non-awaiting stage, or omitting `branchKey`.
- `resume` issues one `pipelineResume` with `{ pipelineId }` for a non-terminal pipeline — rules out run-level `resume` RPC or resuming terminal pipelines (`terminal_pipeline`).
- Pipeline → client routing is operator-visible: on each refresh, build `pipelineOwners: Map<pipelineId, TuiDaemonClient>` from live `pipelineList` responses (same socket map as `list`/`pipeline_list`). When the same `pipelineId` appears on multiple sockets, prefer the invoking socket (`deps.socketPath`), else the lexicographically first socket path (matching `mergePipelineSnapshots` order). Eligible mutations RPC through the resolved owner — rules out always routing through the invoking socket or silently picking an arbitrary duplicate.
- A retained pipeline row with no live owner in `pipelineOwners` reports `stale_non_targetable` and issues no RPC — rules out RPC to a disconnected socket or silent no-ops.
- Successful mutations report the admitted `pipelineId` on `lastCommandResult`, clear buffer/cursor, and restore tree focus — rules out a second feedback channel, a composite decision string, or leaving command focus after success.
- Daemon refusals retain command focus/buffer/cursor and project refusal text verbatim on `lastCommandResult` — rules out rewriting daemon reasons or clearing repairable input.
- Ineligible selections report stable feedback codes on `lastCommandResult`, retain command focus/buffer/cursor, and issue no RPC:
  - shared: `no_selection`, `run_leaf`, `unattributed`, `stale_non_targetable`
  - approve/reject only: `not_awaiting_stage`
  - resume only: `not_pipeline`, `terminal_pipeline`
- Async mutation semantics match `start`: at most one pipeline mutation in flight via shared `admissionPending`; a second focused Enter while pending is ignored; settlements apply only when `shouldApplyCommandSettlement` matches; stale async completions must not overwrite newer editor state or render after monitor teardown.
- Dispatch and eligibility coverage live in `tui-entry.test.tsx` — rules out ink-rendered assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Work

- Add pipeline-steering eligibility helpers and async dispatch in `tui-entry.tsx` `submitCommand`, including `pipelineOwners` on refresh.
- Extend test `fakeClient` with `pipelineApprove`, `pipelineReject`, and `pipelineResume` recording seams.
- Add focused happy-path, ineligible-matrix, daemon-refusal, stale-settlement, pending-submit, and mutation-checkpoint tests named in the acceptance criteria.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` test `typed approve issues pipeline_approve for the selected awaiting stage` drives dispatch against a fake daemon client, asserts the RPC and `(stageId, branchKey)` args, and fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `typed reject issues pipeline_reject for the selected awaiting stage` drives dispatch against a fake daemon client, asserts the RPC and args, and fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `typed resume issues pipeline_resume for the selected non-terminal pipeline` drives dispatch against a fake daemon client, asserts one `pipeline_resume`, and fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `typed approve on ineligible selection reports feedback and issues no RPC` proves each named ineligible code for approve (`no_selection`, `run_leaf`, `unattributed`, `stale_non_targetable`, `not_awaiting_stage`) and issues no RPC; fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `typed reject on ineligible selection reports feedback and issues no RPC` proves the same ineligible matrix as approve and issues no RPC; fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `typed resume on ineligible selection reports feedback and issues no RPC` proves each named ineligible code for resume (`no_selection`, `run_leaf`, `unattributed`, `stale_non_targetable`, `not_pipeline`, `terminal_pipeline`) and issues no RPC; fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `typed approve daemon refusal retains command input and reports verbatim detail` (and symmetric reject/resume titles) proves daemon refusal preserves buffer/cursor/command focus and projects refusal text verbatim on `lastCommandResult`; fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `suppresses stale pipeline mutation settlements` proves `shouldApplyCommandSettlement` suppresses async approve/reject/resume completions after newer editor state or monitor teardown; fails against the pre-fix code.
- [ ] `tui-entry.test.tsx` test `blocks second pipeline mutation while admission is pending` proves shared `admissionPending` ignores a second focused Enter during an in-flight approve/reject/resume; fails against the pre-fix code.
- [ ] Mutation checkpoint: in `tui-entry.test.tsx` test `typed approve on ineligible selection reports feedback and issues no RPC`, a `// @mutate` directive inverting the approve eligibility guard turns that regression RED.
- [ ] Mutation checkpoint: in `tui-entry.test.tsx` test `typed reject on ineligible selection reports feedback and issues no RPC`, a `// @mutate` directive inverting the reject eligibility guard (or the shared approve/reject guard with both pin titles linked) turns that regression RED.
- [ ] Mutation checkpoint: in `tui-entry.test.tsx` test `typed resume on ineligible selection reports feedback and issues no RPC`, a `// @mutate` directive inverting the resume eligibility guard turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

None — operator and parity docs land in `03-docs`.
