# Emit work_boundary_recorded telemetry at the completion boundary

## Problem

The v2 runner records completion state and observability events but never
appends the harness commit facts telemetry analysis needs. For each completion
boundary that produces a harness commit, append one `work_boundary_recorded`
row to the injectable telemetry JSONL sink, sourcing `commit_sha` and
`files_changed` from the completion-commit result (subspec 00) and the join
keys from the stamped boundary.

## Decisions

- Emit exactly one row per completion boundary that produced a `commit_sha`; boundaries with no commit emit nothing — rules out rows without real work facts.
- Record envelope `{ schema_version: 1, record_kind: "work_boundary_recorded", ts }` with `run_id`, `attempt_id`, `outcome_kind`, `run_status`, `commit_sha`, `files_changed` (count) — rules out aliasing observability `boundary_committed` and rules out a path list in this schema version.
- Omit `invocation_id` — the record is attempt-grain; rules out pinning a whole-attempt boundary to one invocation subprocess.
- Source `outcome_kind`/`run_status`/`attempt_id`/`run_id` from the values stamped at that boundary's `commitCompletionBoundary`, and `commit_sha`/`files_changed` from the completion-commit result — rules out re-reading observability logs or agent output.
- Emit at the write-loop / workflow-runner boundary around `commitCompletionBoundary`, using the injectable telemetry sink defaulting to `~/.jarvis/telemetry.jsonl`; keep it outside `commitCompletionBoundary` and the orchestration SQLite store — rules out coupling analysis writes to recovery state.
- An append failure is surfaced separately and does not alter boundary control flow or persistence — rules out failing/altering the run when analysis capture fails.

## Task checklist

- Add a `work_boundary_recorded` record type and a sink capability to append it (extend `telemetry-sink.ts` / the injectable sink so the boundary record can be written to the same JSONL path).
- At the completion-commit emission points in `write-loop.ts` and `workflow-runner.ts`, when the result carries a `commitSha`, append one row with the fields above.
- Default the sink path to `~/.jarvis/telemetry.jsonl`; honor the injected telemetry `sinkPath` when present.
- Report an append failure separately (do not throw through the boundary or change persisted state).
- Add tests asserting the row (fields, count, absence when no commit) with an injected temp-file sink, and that an append failure leaves boundary control flow and persistence unchanged.

## Acceptance criteria

- [ ] A completion boundary that produces a harness commit appends exactly one `work_boundary_recorded` row to the telemetry sink; a boundary that produces no commit appends none.
- [ ] The row is `{ schema_version: 1, record_kind: "work_boundary_recorded", ts, run_id, attempt_id, outcome_kind, run_status, commit_sha, files_changed }` with `files_changed` a count and no `invocation_id` key.
- [ ] `commit_sha` and `files_changed` come from the completion-commit result; `outcome_kind`/`run_status` match the values stamped at that boundary's `commitCompletionBoundary`.
- [ ] The sink path defaults to `~/.jarvis/telemetry.jsonl` and uses the injected telemetry `sinkPath` when supplied; the row is written outside `commitCompletionBoundary` and outside the orchestration SQLite store.
- [ ] A telemetry append failure is reported separately and leaves boundary control flow, the returned result, and persisted orchestration state unchanged.

## Documentation updates

- `v2/docs/telemetry-capture.md` — mark `work_boundary_recorded` implemented, resolve the deferred `files_changed` shape as a count, and remove that item from the Deferred implementation questions list.
