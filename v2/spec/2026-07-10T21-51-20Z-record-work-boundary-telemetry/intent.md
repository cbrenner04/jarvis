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
count of changed files. Do not derive IDs or git facts from agent output or
logs.

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
- Source commit facts from the harness commit result — rules out parsing agent output or rereading observability logs.
- Keep telemetry outside `commitCompletionBoundary` and orchestration SQLite — rules out coupling analysis writes to recovery state.

## Documentation updates

- `v2/docs/telemetry-capture.md` — mark `work_boundary_recorded` implemented and resolve the deferred `files_changed` shape as a count.

## Prerequisites

- A v2 completion boundary that changes work creates a harness commit and exposes its commit SHA and changed-file count to the boundary layer

## Blocker

The changed-file-count half of the prerequisite is not present in committed code.

- The harness commit result is `CompletionCommitResult = { commitSha?: string }` (`v2/src/execution/completion-commit.ts:7`). It exposes only the commit SHA, which flows to `WriteLoopResult.commitSha` (`v2/src/execution/write-loop.ts:43`). No changed-file count is returned by the committer or surfaced at the write-loop / workflow-runner boundary.
- The only `changedFiles` helper is a private shrink-prompt utility in `workflow-runner.ts:708`, computed by diffing against `baseRef` — not part of the harness commit result and not available where `commitCompletionBoundary` is called.

This blocks the design: the intent's decision "Source commit facts from the harness commit result" forbids deriving `files_changed` from git or logs, but the harness commit result carries no count to source. Adding that count to the commit result is net-new boundary-layer behavior the intent treats as an already-satisfied prerequisite, so it is out of scope for this spec.

To unblock, either (a) land the count exposure first — have the completion committer return the changed-file count alongside `commitSha` on `CompletionCommitResult`, threaded to the boundary layer — then resume this plan, or (b) revise the intent to bring that exposure into scope (and relax the "source from harness commit result only" decision so `files_changed` may be computed at the boundary).
