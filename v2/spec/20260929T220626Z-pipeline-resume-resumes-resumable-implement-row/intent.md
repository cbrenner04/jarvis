---
name: pipeline-resume-resumes-resumable-implement-row
---

# `pipeline resume` resumes a resumable implement write row in place

## Problem

`jarvis pipeline resume <id> <branch-key>` on a failed implement stage whose write row is resumable re-dispatches the workflow; the re-run preflight refuses (checkpoint commit not on base, base advanced) and the stage re-fails, losing its `workflowInvocationId` (pipeline `d28c8d6e`, row `a2762fc9`).

## Decisions

- When the stage's linked write row has `nextAction: resume`, `pipeline resume` resumes that row with `run resume` admission and keeps the stage linked to it; re-dispatch only for non-resumable rows.
- If `run resume` admission rejects the row (no longer resumable, already running), `pipeline resume` errors with the admission reason; it does not fall back to re-dispatch.
- Out of scope: automatic re-drive of refused gate slots (`redrive-slot-refused-gates`).

## Acceptance criteria

- [ ] A test proves `pipeline resume` on a stage whose write row settled `gate_invocation_refused` resumes that row in place (no preflight, no new worktree) with base advanced past the lane's merge base; it fails against the pre-fix re-dispatch.
- [ ] A test proves `pipeline resume` errors with the admission reason, and does not re-dispatch, when the row's `run resume` admission rejects it.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` "re-dispatches only the failed continuation stage and preserves predecessor invocation IDs" stays green (non-resumable rows still re-dispatch).

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume on a resumable implement stage.

## Prerequisites

- Requires `implement-stage-settles-from-recovered-write-row` merged first (plan blocks until then). A failed implement stage stays linked to its resumable write row and settles from that row's later terminal outcome, dispatching its successor on success.
