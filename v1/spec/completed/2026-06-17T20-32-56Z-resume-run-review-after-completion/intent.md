---
name: resume-run-review-after-completion
---

## Intent

Allow an operator to resume a completed `jarvis1 run` spec so the post-completion review phase can run or retry without reopening implementation work.

## Prerequisites

- Patch mode already detects a complete spec and has a post-completion review phase.

## Behavior

- A completed spec can be resumed directly into the post-completion review workflow.
- Resume does not invoke implementation agents or require unchecked spec tasks.
- Resume preserves the existing draft PR/worktree semantics and retries the normal review readiness path.
- Resume remains a no-op or clear operator error when review is disabled, git mode is off, or no implementation PR/worktree exists.

## Decisions

- Resume targets completed specs instead of adding a synthetic unchecked review task; this rules out mutating spec acceptance state to drive harness-only review.
- Review resume is a patch-run workflow, not plan resume; this rules out overloading `jarvis1 plan --resume` for implementation PR review.
- Deferred to first consumer: exact CLI spelling for review resume — pin when command parsing and current flags are specified.

