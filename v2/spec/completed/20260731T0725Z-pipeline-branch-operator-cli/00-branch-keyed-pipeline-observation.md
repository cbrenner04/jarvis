# Branch-keyed pipeline observation

## Problem

`pipeline_list` and `derivePipelineBoundary` project one row per `stageId` and name approval boundaries without `branchKey`. After an intent split the operator cannot tell which branch is awaiting from daemon observation alone.

## Surface

Primary: `v2/src/daemon/pipeline-observation.ts`. In-scope: `daemon-pipeline-observation.test.ts`, `pipeline_list` / `pipeline_wait` handler wiring in `daemon.ts`.

## Prerequisites

- Pipeline stage rows are keyed by `(stageId, branchKey)` and `loadPipeline` orders stages by `position` then `branch_key` (`v2/spec/20260731T012722Z-pipeline-branch-keyed-stage-records/`).
- Pipeline execution fans out downstream stages per ready-intent branch and scopes approval gates per branch (`v2/spec/20260731T030451Z-pipeline-intent-split-fan-out-execution/`).
- `pipeline_list` and `pipeline_wait` exist (`v2/spec/completed/20260730T052321Z-pipeline-daemon-observation-and-wait/`).

## Decisions

- `pipeline_list` stage projection includes `branchKey` and emits one row per durable branch row in `loadPipeline` order — rules out collapsing to one row per `stageId`.
- `derivePipelineBoundary` `awaiting-approval` includes `branchKey` naming the blocking gate row — rules out anonymous approval boundaries.
- When derived state is `awaiting-approval`, boundary selection walks durable stage rows in `loadPipeline` order and returns the first unsatisfied approval row (`status` `awaiting` or `pending`) after satisfied predecessors within that row's branch suffix — rules out `stageId`-only boundaries that omit branch identity.
- `pipeline_wait` returns the same `awaiting-approval` envelope as `derivePipelineBoundary` — rules out a wait-specific boundary shape.
- Single-default-branch pipelines project `branchKey: "default"` on every stage row — rules out omitting `branchKey` when only one branch exists.
- Out of scope: CLI syntax, operator-runbook updates, and `pipeline_approve` / `pipeline_reject` admission (sibling subspec 01; daemon RPC already accepts `branchKey`).

## Task checklist

- Extend `PipelineSnapshot`, `PipelineBoundaryResult`, `projectPipelineSnapshot`, and `derivePipelineBoundary` in `pipeline-observation.ts`.
- Add two-branch `pipeline_list` projection and `derivePipelineBoundary` coverage in `daemon-pipeline-observation.test.ts`; update single-branch fixtures to expect `branchKey: "default"`.
- Update `v2/docs/daemon-host.md` § Pipeline snapshots and § Pipeline wait; remove the stale "not yet projected" deferral in § Branch fan-out execution.

## Acceptance criteria

- [x] `daemon-pipeline-observation.test.ts` — two-branch pipeline: `pipeline_list` projection shows distinguishable `branchKey` values and per-branch statuses for every branch row; flattening to one row per `stageId` makes the test fail.
- [x] `daemon-pipeline-observation.test.ts` — two-branch pipeline with one gate row `awaiting` and one sibling branch `running`: `derivePipelineBoundary` returns `{ kind: "awaiting-approval", stageId, branchKey }` naming the awaiting branch; omitting `branchKey` makes the test fail.
- [x] `daemon-pipeline-observation.test.ts` — source-mutating the branch-row projection (collapse to one row per `stageId`) or hardcoding the `awaiting-approval` `branchKey` makes the two-branch regression RED; comment checkpoints name both mutations. Verified by hand.
- [x] `daemon-pipeline-observation.test.ts` — `"pipeline_list returns an empty pipelines array for an empty store"` stays green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_list` stage rows include `branchKey`; `pipeline_wait` `awaiting-approval` boundary includes `branchKey`; remove stale deferral that observation omits branch keys.
