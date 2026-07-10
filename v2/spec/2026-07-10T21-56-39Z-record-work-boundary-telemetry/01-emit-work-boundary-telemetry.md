# Emit work_boundary_recorded telemetry at the completion boundary

## Problem

The v2 runner records completion state and observability events but never
appends the harness commit facts telemetry analysis needs. For each completion
boundary that produces a harness commit, append a `work_boundary_recorded`
row to the injectable telemetry JSONL sink, sourcing `commit_sha` and
`files_changed` from the completion-commit result (subspec 00) and the join
keys from the boundary that produced the commit.

The stamped join keys (`attempt_id`/`outcome_kind`/`run_status`) are co-located
with the publish call only on the fresh-complete path. At the workflow publish
site and the resume-republish path only a `WriteLoopResult` is in scope, and it
carries none of them. This subspec threads those values onto the result before
they can be read at the emit point.

## Decisions

- Thread the stamped `attempt_id`/`outcome_kind`/`run_status` onto `WriteLoopResult`, populated at every path that publishes a completion commit including resume-republish — mirrors how subspec 00 puts `filesChanged` on the commit result; rules out reading keys that are out of scope at the workflow and resume publish sites (the headline sourcing decision is otherwise unimplementable at 2 of 3 sites).
- For a multi-step workflow (one publish for several write steps), the keys come from the publishing step's attempt — rules out ambiguity over which step's boundary "that boundary" means; dissolves once the keys ride the result.
- Emit at least one row per completion boundary that produced a `commit_sha`, including the resume-republish of a pending commit; boundaries with no commit emit nothing — rules out rows without real work facts. Not exactly-once: an append-only sink with no dedup key cannot avoid a lost row on a crash before publish or a duplicate on a crash after emit-before-return, and telemetry is best-effort.
- Record envelope `{ schema_version: 1, record_kind: "work_boundary_recorded", ts }` with `run_id`, `attempt_id`, `outcome_kind`, `run_status`, `commit_sha`, `files_changed` (count) — rules out aliasing observability `boundary_committed` and rules out a path list in this schema version.
- Omit `invocation_id` — the record is attempt-grain; rules out pinning a whole-attempt boundary to one invocation subprocess.
- Source `commit_sha`/`files_changed` from the completion-commit result and the join keys from the result-threaded stamp — rules out re-reading observability logs or agent output.
- Emission is gated on an attached telemetry block; only then does the sink path resolve (injected `sinkPath`, else default `~/.jarvis/telemetry.jsonl`) — rules out a bare write-loop invocation (including existing tests) writing the operator's real home file; matches invocation telemetry being opt-in.
- Append via a v2-local boundary sink builder / path-append helper, not by widening the shared `InvocationTelemetrySink` union to admit a v2-only record kind — rules out a v2 concept leaking into `shared/**` (forbidden by AGENTS.md).
- Emit at the write-loop / workflow-runner boundary around `commitCompletionBoundary`, outside `commitCompletionBoundary` and the orchestration SQLite store — rules out coupling analysis writes to recovery state.
- An append failure is surfaced separately and does not alter boundary control flow or persistence — rules out failing/altering the run when analysis capture fails.

## Task checklist

- Add the stamped `attempt_id`/`outcome_kind`/`run_status` to `WriteLoopResult`, populating them at each completion-commit publish path in `write-loop.ts` and `workflow-runner.ts`, including the resume-republish path that today reconstructs a result without them.
- Add a `work_boundary_recorded` record type and a v2-local sink capability to append it to the JSONL path (a boundary-sink builder or generic path-append helper in v2 — do not widen the shared invocation-sink union).
- At the completion-commit emission points in `write-loop.ts` and `workflow-runner.ts`, when the result carries a `commitSha` and a telemetry block is attached, append one row with the fields above sourced from the result.
- Gate on the attached telemetry block; within it resolve `sinkPath`, else default `~/.jarvis/telemetry.jsonl`.
- Report an append failure separately (do not throw through the boundary or change persisted state).
- Add tests asserting the row (fields, count, at-least-one on both fresh-complete and resume-republish, absence when no commit and when no telemetry block is attached) with an injected temp-file sink, and that an append failure leaves boundary control flow and persistence unchanged.

## Acceptance criteria

- [x] A completion boundary that produces a harness commit appends at least one `work_boundary_recorded` row to the telemetry sink; a boundary that produces no commit, and any boundary with no telemetry block attached, appends none.
- [x] The resume-republish of a pending completion commit appends a `work_boundary_recorded` row carrying the same join keys and `files_changed` as the original publish would.
- [x] The row is `{ schema_version: 1, record_kind: "work_boundary_recorded", ts, run_id, attempt_id, outcome_kind, run_status, commit_sha, files_changed }` with `files_changed` a count and no `invocation_id` key.
- [x] `commit_sha` and `files_changed` come from the completion-commit result; `attempt_id`/`outcome_kind`/`run_status` come from the stamp threaded onto the publishing boundary's `WriteLoopResult` — reachable at the fresh-complete, workflow, and resume-republish publish sites.
- [x] Emission is gated on an attached telemetry block; when attached, the sink path uses the injected `sinkPath` when supplied and otherwise defaults to `~/.jarvis/telemetry.jsonl`; the row is written outside `commitCompletionBoundary` and outside the orchestration SQLite store.
- [x] The record is appended through a v2-local sink helper; `shared/**` gains no `work_boundary_recorded` type.
- [x] A telemetry append failure is reported separately and leaves boundary control flow, the returned result, and persisted orchestration state unchanged.

## Documentation updates

- `v2/docs/telemetry-capture.md` — mark `work_boundary_recorded` implemented, resolve the deferred `files_changed` shape as a count (name-only, no rename detection), remove that item from the Deferred implementation questions list, and note the emission is at-least-once (best-effort, not exactly-once).
