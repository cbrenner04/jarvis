---
name: lane-pr-outcomes-settle-runs-and-stages
---

# Lane PR history outcomes settle runs and pipeline stages without republishing

## Problem

Even when publication stops before `gh pr create`, resume and pipeline recovery still treat the lane as publication-failed or keep driving republication, so operator-closed or already-merged lane PRs do not settle honestly.

## Decisions

- `lane_pr_merged` settles the run and linked pipeline stage as success, retaining the merged PR number and url as publication evidence.
- `lane_pr_closed` settles as a terminal non-failure (`lane_pr_closed` outcome) that is not `failed` and does not advertise recovery that reopens publication on the same closed PR.
- A list-probe publication failure settles `failed` with the probe cause on the run row and linked stage settlement reads the same record.

## Acceptance criteria

- [ ] `workflow-runner-publication.test.ts` or `pipeline-execution.test.ts` (settlement cases only, not daemon list/wait projection owned by sibling intent): `lane_pr_merged` through completion publication settles the run completed with PR evidence and does not append a republication failure; fails against pre-fix behavior.
- [ ] Same test surface: `lane_pr_closed` settles terminal `lane_pr_closed` without `status: failed` and without a resumable republication recovery path; fails against pre-fix duplicate-draft republication.
- [ ] Same test surface: list-probe failure settles failed with the probe message on the run and matching pipeline stage failure detail.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — resumed or recovered lanes whose newest PR is closed or merged settle on `lane_pr_closed` or `lane_pr_merged` instead of opening another draft.
- `v2/docs/v1-behaviors.md` — lane PR closed/merged terminal settlement on runs and pipeline stages.

## Prerequisites

- Completion publication lists head+base PRs with full state before creating; when the newest match is closed or merged it yields `lane_pr_closed` or `lane_pr_merged` with the PR number instead of calling `gh pr create`, unless republish opt-in is set on the publisher input.
- A failed head+base PR list probe does not create a PR and surfaces a permanent publication failure naming the probe error.
- An open draft on the same head+base is still reused when present alongside older closed or merged history.
