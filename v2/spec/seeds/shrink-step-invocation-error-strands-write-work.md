---
name: shrink-step-invocation-error-strands-write-work
---

# A shrink-step invocation error strands completed write work non-retryably

## Problem

In `jarvis run workflow implement`, the write step commits nothing itself — the shrink step (and
publication) commit. Observed 2026-07-17: the write invocation succeeded (real code in the worktree),
then the shrink invocation hit `invocation_error`; the run settled `failed` / `nextAction: stop`
(non-retryable), leaving the completed implementation **uncommitted** in the worktree with no commit,
no push, no PR, and no jarvis-native recovery (resume refused). The operator had to abandon and
re-run from scratch, re-spending the write tokens and discarding a good implementation.

## Decisions

- Commit the write-step output **before** the shrink pass runs (or make a shrink `invocation_error`
  resumable), so a cosmetic/simplification step failing never strands completed implementation work;
  rules out the current "shrink owns the only commit" coupling.
- A shrink failure after a committed write should be retryable/resumable, not terminal `stop`; rules
  out forcing a full re-run for a post-write step failure.

## Out of scope

- The shrink pass's own retry/timeout budget (see `review-and-shrink-steps-have-no-timeout`).

## Documentation updates

- `v2/docs/workflow-runner.md` — commit ordering relative to shrink; recovery on shrink failure.
