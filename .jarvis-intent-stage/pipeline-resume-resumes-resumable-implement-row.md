---
name: pipeline-resume-resumes-resumable-implement-row
---

# `pipeline resume` resumes a resumable implement write row in place

## Problem

`jarvis pipeline resume <id> <branch-key>` on a failed implement stage whose write row is resumable re-dispatches the workflow; the re-run preflight refuses (checkpoint commit not on base, base advanced) and the stage re-fails, losing its `workflowInvocationId` (pipeline `d28c8d6e`, row `a2762fc9`).

## Decisions

- When the stage's linked write row has `nextAction: resume`, `pipeline resume` resumes that row with `run resume` admission and keeps the stage linked to it; re-dispatch only for non-resumable rows.
- Out of scope: automatic re-drive of refused gate slots (`redrive-slot-refused-gates`).

## Acceptance criteria

- [ ] A test proves `pipeline resume` on a stage whose write row settled `gate_invocation_refused` resumes that row in place (no preflight, no new worktree) with base advanced past the lane's merge base; it fails against the pre-fix re-dispatch.
- [ ] A test proves the resumed row's completion settles the stage `succeeded` and dispatches its successor.
- [ ] A test proves a non-resumable failed implement stage still re-dispatches.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume on a resumable implement stage.

## Prerequisites

- A failed implement stage stays linked to its resumable write row and settles from that row's later terminal outcome, dispatching its successor on success.
