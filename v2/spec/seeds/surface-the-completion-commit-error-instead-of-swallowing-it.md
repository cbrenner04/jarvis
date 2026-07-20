# Surface the completion-commit error instead of swallowing it

## Problem

When a workflow's completion boundary fails, the run records `completion_commit_failed`
but the underlying error is **not retained anywhere the operator can read it**:

- The `loop_finished` log event for the commit-failed paths carries no message
  (`workflow-runner.ts` ~735 and ~849; `write-loop.ts` completion paths).
- The durable `runs` row has no error column — `run list` / `run wait` return only
  `{reason: "completion_commit_failed"}`.
- The detailed `completionCommitError` is returned to the CLI caller only, which for a
  long `jarvis run workflow …` is usually a shell that already timed out.

Observed 2026-07-19: a one-line title-resolution regression in intent landings (fixed by
PR #1816) presented as an opaque, reproducible `completion_commit_failed` that `run resume`
no-op'd. Root-causing it required hand-instrumenting `console.error` in the daemon source
and a manual bounce — the error was otherwise a complete black box. The next
completion-commit failure (any cause) will be just as blind.

## Decisions

- The caught completion-commit error message is attached to the `loop_finished`
  (`completion_commit_failed`) log event, mirroring how `publicationFailure` is already
  attached on the ready-failure paths; rules out an empty log event for a failed commit.
- The message is retrievable via `run list` / `run wait` on the failed row (e.g. an
  `error.completionCommitError` / `publicationFailure` field), so diagnosis needs neither
  the live CLI output nor daemon-source instrumentation.
- Applies to every completion-commit failure path: the committer throw, the
  "no commitSha + uncommitted paths" path, and the write-loop repair path.

## Acceptance criteria

- [ ] A completion-commit failure logs the underlying error message in its
      `loop_finished` event (not an empty event).
- [ ] `jarvis run wait <id>` / `run list` on a `completion_commit_failed` row exposes the
      underlying error message.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — note that completion-commit errors are now readable via
  `run log` / `run wait`, replacing the "error is swallowed, instrument the daemon" workaround.

## Notes

Sibling context: #1816 fixed the specific title-resolution cause; this seed is about the
observability gap that made it expensive to find, independent of any single cause.
