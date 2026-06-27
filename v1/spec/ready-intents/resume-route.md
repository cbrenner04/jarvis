---
name: resume-route
---

# A resume prompt continues an existing job from persisted state

## Problem

Prompts like `continue spec 3` or a resume command reference work already
started. The controller must pick up that job's durable state and continue it
rather than starting fresh.

## Direction

For a resume route: resolve the referenced job/seed/intent from the persisted
job-state record, restore its context, and continue execution via existing
jarvis commands from where it left off. End with a status summary. If the
referenced job cannot be resolved, exit with a summary asking the operator to
clarify — same conservative stance as routing.

## Documentation updates

- `v1/docs/` controller reference — document the resume route and its
  unresolved-job exit.
- `v2/docs/v1-behaviors.md` — record the resume contract.

## Prerequisites
- jarvis classifies a prompt and dispatches a resume route
- the controller persists durable job state for a started job
