---
name: pipeline-approval-stage-and-resume
---

# Pipelines: human approval stage, approve/reject, stage-scoped resume

Slice 3 of [per-project pipelines](../per-project-pipelines-brief.md). Prereq:
`pipeline-durable-stage-state-and-daemon-execution`.

## Problem

The point of a pipeline is that the operator reviews between stages. Without a durable approval
stage, "approve" is an operator remembering to type the next command — and a failed stage restarts
the whole pipeline, re-spending every prior stage's tokens.

## Decisions

- Human approval is a durable stage with explicit `awaiting` / `approved` / `rejected` state, not an
  implicit pause. Rules out modelling approval as a paused workflow run.
- Approval decisions are recorded durably with the deciding stage ID; a restart re-enters
  `awaiting`, never auto-approves. Rules out fail-open.
- Reject settles the pipeline terminally at that stage. Rules out looping back to re-run the prior
  stage implicitly — re-running is a fresh explicit action.
- Resume restarts at the failed or awaiting-approval stage, reusing prior stages' recorded
  artifacts. Rules out restarting at pipeline start.
- Resume on a terminal (completed or rejected) pipeline is a named refusal, not a silent no-op.

## Acceptance criteria

- [ ] An approval stage settles `awaiting` and blocks later stages until decided; a test asserts no
      later dispatch while awaiting.
- [ ] Approve advances to the next stage; reject settles the pipeline terminally — one test each.
- [ ] Approval state survives a daemon restart in `awaiting`; a test asserts it is not auto-approved
      and not lost.
- [ ] Resume re-enters at the failed stage and does not re-dispatch completed prior stages; a test
      asserts prior stages' invocation IDs are unchanged after resume.
- [ ] Resume on a completed or rejected pipeline refuses with a named error.

## Documentation updates

- `v2/docs/operator-runbook.md` — approving/rejecting a stage; what resume replays.
- `v2/docs/daemon-host.md` — approval state machine and resume admission predicate.
