---
name: daemon-projects-lane-pr-settlement
---

# Daemon list, wait, pipeline, and notifications report lane PR settlement

## Problem

Runs and stages that settle on `lane_pr_closed` or `lane_pr_merged` do not appear consistently on `run list`/`run wait`, pipeline snapshots, or the notification sink, so operators learn about duplicate PRs from GitHub instead of Jarvis.

## Decisions

- Run list/wait operator errors and pipeline terminal stage observation project `lane_pr_closed` and `lane_pr_merged` with the PR number from the durable settlement record without recomposing a different diagnosis.
- Operator incidents delivered to `notificationSinkCommand` include the same lane outcome and PR number when a run or pipeline stage crosses that boundary.

## Acceptance criteria

- [ ] `daemon-test-inventory.test.ts` or focused `operator-notification.test.ts` / `run.test.ts` coverage: a run settled `lane_pr_closed` emits an incident naming `lane_pr_closed` and the PR number; fails against pre-fix projections that omit the outcome.
- [ ] Pipeline list/wait or `pipeline-execution.test.ts`: a stage settled after `lane_pr_merged` exposes success with the merged PR number in stage observation, not publication-failed; fails against pre-fix free-form failure detail.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — operator incidents include lane PR closed/merged settlement outcomes when configured.

## Prerequisites

- Completion publication yields `lane_pr_closed`, `lane_pr_merged`, or probe failure without creating a PR when head+base history demands it.
- `lane_pr_merged` settles linked runs and pipeline stages as success with merged PR evidence.
- `lane_pr_closed` settles as a terminal non-failure that does not treat operator-closed lane PRs as a failed republication trigger.
