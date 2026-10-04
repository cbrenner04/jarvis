---
name: record-work-boundary-telemetry
---

# Record committed work at completion boundaries

## Problem

The v2 runner records completion state and observability events, but does not
append the harness commit facts needed for telemetry analysis.

## Direction

Append one `work_boundary_recorded` telemetry row for each completion boundary
that produces a harness commit. Use the boundary's stamped `run_id` and
`attempt_id` plus `outcome_kind`, `run_status`, harness `commit_sha`, and the
count of changed files. The completion committer today returns only
`commit_sha`; this work extends the harness commit result to also carry the
changed-file count (computed by the harness from the completion commit's own
trees, e.g. base-tree vs completion-tree) and threads it to the boundary layer.
`files_changed` is thus a harness-sourced git fact — never derived from agent
output or observability logs.

Use the injectable telemetry JSONL sink, defaulting to
`~/.jarvis/telemetry.jsonl`. Keep emission at the write-loop/workflow-runner
boundary around `commitCompletionBoundary`, outside the orchestration store.
An append failure is reported separately and does not alter boundary control
flow or persistence.

## Decisions

- Emit one row only when a completion boundary produces a commit — rules out rows without real work facts.
- Use `{ schema_version: 1, record_kind: "work_boundary_recorded", ts }` with the required boundary fields — rules out aliasing observability `boundary_committed`.
- Record `files_changed` as a count — rules out a path list in this schema version.
- Omit `invocation_id` because the record is attempt-grain — rules out assigning a whole-attempt boundary to one invocation.
- Extend the harness completion-commit result to carry the changed-file count alongside `commit_sha`, computed by the harness from the commit's trees, and source both facts from that result — rules out parsing agent output or rereading observability logs, and rules out treating the count as an already-exposed prerequisite.
- Keep telemetry outside `commitCompletionBoundary` and orchestration SQLite — rules out coupling analysis writes to recovery state.

## Documentation updates

- `v2/docs/telemetry-capture.md` — mark `work_boundary_recorded` implemented and resolve the deferred `files_changed` shape as a count.

## Prerequisites

- A v2 completion boundary that changes work creates a harness commit and exposes its commit SHA to the boundary layer (`CompletionCommitResult.commitSha`, `v2/src/execution/completion-commit.ts`). This work extends that result to also carry the changed-file count.
