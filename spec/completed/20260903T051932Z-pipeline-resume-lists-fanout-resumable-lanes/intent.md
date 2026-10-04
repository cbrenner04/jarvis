---
name: pipeline-resume-lists-fanout-resumable-lanes
---

# Pipeline resume lists resumable fan-out lanes when branch key is omitted

## Problem

Fan-out is the norm after intent split, but `jarvis pipeline resume <pipeline-id>` without a branch key either derives awaiting-approval continuation or refuses opaquely — operators detour through `pipeline list --json` to discover which `branch-key` to pass for a failed plan lane.

## Decision ledger

- Unscoped resume on a fan-out pipeline with one or more branch-scoped failed plan lanes eligible for `resolveBranchResumeAdmission` lists those `branchKey` values instead of claiming `awaiting-approval` or refusing with only `pipeline_not_resumable`; rules out silent whole-pipeline claim and opaque refusal when branch-scoped resume is required (reachable today per operator-runbook § Pipeline resume).
- When no such failed plan lanes exist, unscoped resume keeps today's `awaiting-approval` claim, deferred-settlement, and other whole-pipeline paths unchanged; rules out regressing existing unscoped continuation.
- Listing scope is failed plan lanes only — not wedged `running`/`interrupted` lanes that already admit unscoped resume per runbook; rules out broadening discoverability beyond the fan-out failed-branch detour this intent targets.
- Listing is discoverability only — it does not resume multiple lanes in one call; rules out implicit multi-lane dispatch.
- Listing emits a structured refusal (non-zero exit, branch keys on stderr with the daemon `reason`) consistent with other resume refusals; rules out a success exit that only prints keys.
- Deferred to first consumer: exact stderr layout and sort order for listed branch keys — pin when the CLI formatter needs it.

## Acceptance criteria

- [ ] `pipeline.test.ts` drives `pipeline resume <pipeline-id>` with no branch key on a fan-out pipeline whose derived state is `awaiting-approval` while at least one branch-scoped failed plan lane is resumable and asserts non-zero exit with those `branchKey` values on stderr instead of `kind: "resumed"` or an opaque `pipeline_not_resumable` only; fails against the pre-fix path that claims `awaiting-approval` without naming the failed branch.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Pipeline resume: omitting `branch-key` on a fan-out pipeline with resumable failed plan lanes lists those lanes instead of claiming `awaiting-approval` or opaque refusal; unscoped paths without such lanes unchanged.

## Primary implementation surface

v2/src/daemon/pipeline-execution.ts

## Prerequisites

- None.
