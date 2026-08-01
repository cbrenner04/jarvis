---
name: pipeline-list-stage-timestamps
---

# pipeline_list stage timestamps

Stage `startedAt` and `endedAt` are durable on `PipelineStageRecord` but `projectPipelineSnapshot`
drops them. The TUI cannot render honest stage elapsed until they reach the `pipeline_list` wire.

## Problem

Operators watching a pipeline cannot tell how long a stage has been running without leaving the TUI.
Stage timing exists in the store; observation projection omits it.

## Decisions

- `projectPipelineSnapshot` adds `startedAt` and `endedAt` on each stage row, `null` when unset — rules out deriving stage elapsed from run rows.
- Out of scope: elapsed formatting, TUI rendering, local tick, and `list` run start projection — sibling CLI intent.

## Acceptance criteria

- [ ] `projectPipelineSnapshot` emits each stage's `startedAt` and `endedAt`, `null` when unset, from the durable record; omitting either field from stage projection makes `daemon-pipeline-observation.test.ts` fail.
- [ ] `daemon-pipeline-observation.test.ts` — `"pipeline_list returns an empty pipelines array for an empty store"` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_list` stage rows include `startedAt` and `endedAt`.

## Prerequisites

- `PipelineStageRecord` carries `startedAt` and `endedAt` in the durable store.
- `projectPipelineSnapshot` and `PipelineSnapshot` exist and already emit pipeline `createdAt`, `finishedAtMs`, and per-stage `branchKey`, `status`, and `workflowInvocationId`.
- `pipeline_list` returns durable pipeline snapshots without following live transitions.
