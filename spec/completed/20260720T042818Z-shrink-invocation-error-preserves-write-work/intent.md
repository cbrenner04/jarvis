---
name: shrink-invocation-error-preserves-write-work
---

# Shrink invocation error preserves and recovers completed write work

## Problem

In `jarvis run workflow implement` the write step commits nothing; the hidden
shrink pass (and publication) own the only commit. When the write invocation
succeeds but the shrink invocation hits `invocation_error`, the run settles
`failed` / `nextAction: stop` (non-retryable), stranding the completed
implementation uncommitted with no commit, push, or PR. The operator must
abandon and re-run from scratch, re-spending write tokens and discarding good
work.

## Behavior

- Completed `implement` write output is committed before the hidden shrink pass
  runs, so a shrink `invocation_error` never leaves finished implementation work
  uncommitted in the worktree.
- A shrink failure after a committed write settles retryable/resumable, not
  terminal `stop`; resume finishes the shrink pass (or advances past it) and
  reaches publication without re-running the write step.

## Out of scope

- The shrink pass's own retry/timeout budget (`review-and-shrink-steps-have-no-timeout`).

## Documentation updates

- `v2/docs/workflow-runner.md` — commit ordering relative to shrink; recovery on shrink failure.

## Prerequisites
