---
name: new-intent-workflow-run
---

# A new-intent prompt resolves state, runs a workflow, and persists the job

## Problem

When the router classifies a prompt as a new intent (the seed case), nothing
runs it. The controller must turn that intent into actual work via existing
jarvis commands and leave a durable record so the job can later be resumed or
reported on.

## Direction

For a new-intent route: resolve repo/runbook/state, choose a workflow, and
execute it by driving existing jarvis commands (e.g. plan/run) — the controller
decides the next step from each result, not a chat loop. Persist job state
durably as the job advances so it survives process exit. End with a clear
status summary of what ran and the outcome. This slice establishes the durable
job-state record that resume and error-resume consume.

## Documentation updates

- `v1/docs/` controller reference — document new-intent execution, the persisted
  job-state record, and the status summary.
- `v2/docs/v1-behaviors.md` — record the new-intent execution and job-state
  persistence contract.

## Prerequisites
- jarvis classifies a prompt and dispatches a new-intent route
