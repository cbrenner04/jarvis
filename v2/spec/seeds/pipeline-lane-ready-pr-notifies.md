---
name: pipeline-lane-ready-pr-notifies
---

# A fan-out pipeline lane that publishes a ready PR raises no incident

## Problem

`v2/src/daemon/operator-incidents.ts` derives pipeline incidents for approval gates, failed stages, and whole-pipeline terminals only. On a fan-out pipeline whose other lanes still wait at gates, a lane whose implement stage succeeds and flips its PR to ready produces nothing: the pipeline is not terminal and nothing failed. The operator's next action — review and merge that PR, then approve the dependent lanes — has no wake signal, so a sequential lane chain idles until someone polls.

## Evidence (2026-09-14)

Pipeline `25784a7e` (`observability-sinks-honor-jarvis-home-and-cap-blobs`, three serial lanes): lane `session-logs-honor-jarvis-home` implement settled `succeeded` and published ready [#3918](https://github.com/cbrenner04/jarvis/pull/3918) with green CI; `~/.jarvis/notifications.jsonl` recorded no incident, while the two dependent lanes sat at `approve-intent`. Found only by manual inspection.

## Decisions

- A stage-scoped incident `stage-succeeded` (naming `pipelineId`, `stageId`, `branchKey`, and PR number/url when present) fires when an `implement` stage settles `succeeded` on a pipeline that is not yet terminal.
- Keyed per stage settlement like `stage-failed`, so a re-run lane notifies again.
- Whole-pipeline terminal incidents are unchanged.

## Acceptance criteria

- [ ] A test proves a fan-out lane's implement stage settling `succeeded` with siblings still `awaiting` derives one `stage-succeeded` incident carrying the PR number; it fails against the pre-fix derivation.
- [ ] A test proves a single-lane pipeline reaching terminal emits only the existing terminal incident, not both.

## Documentation updates

- `v2/docs/daemon-host.md` § Operator notifications — `stage-succeeded`.
