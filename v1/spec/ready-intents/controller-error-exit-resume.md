---
name: controller-error-exit-resume
---

# Execution errors exit with a why-summary and a resume command

## Problem

The seed's first iteration deliberately does not do in-loop recovery: when a
workflow step errors, the controller should stop cleanly rather than improvise.
The operator needs to know why it stopped and how to pick the job back up.

## Direction

When a workflow step returns a classified error event, the controller exits
non-zero. On exit it prints a summary explaining why it stopped and a
copy-pasteable command to resume the job. No automatic retry, repair, or
escalation in this iteration — error means exit. The resume command targets the
persisted job so the resume route can continue it.

## Documentation updates

- `v1/docs/` controller reference — document the error-exit behavior, the
  why-summary, and the resume command.
- `v2/docs/v1-behaviors.md` — record the first-iteration error-exit contract so
  v2 can deliberately revise toward in-loop recovery.

## Prerequisites
- the controller executes a workflow via existing jarvis commands
- the controller persists durable job state for a started job
