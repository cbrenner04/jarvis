---
name: pipeline-lane-ready-pr-notifies
---

# A fan-out pipeline lane that publishes a ready PR raises a stage-succeeded incident

Unsplit rationale: the fix is one derivation change in the daemon's operator-incident module plus its doc; no other module boundary changes.

## Primary implementation surface

- `v2/src/daemon/operator-incidents.ts`

## Prerequisites

## Problem

Incidents derive only for approval gates, failed stages, and whole-pipeline terminals. A fan-out lane whose `implement` stage succeeds and flips its PR to ready, while sibling lanes wait at gates, emits nothing, so the operator's merge-then-approve step has no wake signal (evidence: pipeline `25784a7e`, PR #3918, 2026-09-14).

## Decisions

- New stage-scoped incident `stage-succeeded` (fields: `pipelineId`, `stageId`, `branchKey`, PR number/url when present) fires when an `implement` stage settles `succeeded` on a non-terminal pipeline.
- Keyed per stage settlement like `stage-failed`, so a re-run lane notifies again.
- Whole-pipeline terminal incidents unchanged; a pipeline that is terminal emits only the terminal incident.

## Acceptance criteria

- [ ] A test proves a fan-out lane's implement stage settling `succeeded` with siblings still `awaiting` derives one `stage-succeeded` incident carrying the PR number; it fails against the pre-fix derivation.
- [ ] A test proves a single-lane pipeline reaching terminal emits only the existing terminal incident, not both.

## Documentation updates

- `v2/docs/daemon-host.md` § Operator notifications — document `stage-succeeded`.
