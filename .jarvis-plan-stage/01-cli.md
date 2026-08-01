# CLI

Extend `pipeline_list` projection with pipeline `createdAt` and terminal finish time so the tree
model can order actives and terminals without inventing sort keys. Stage `startedAt`/`endedAt` for

## Problem

`projectPipelineSnapshot` omits `createdAt` and terminal finish time. The tree model needs both for
ordering pins in [tui-overhaul-brief.md § Left pane — retention](../tui-overhaul-brief.md#left-pane--retention-fifo).

## Decisions

## Tasks

- Extend `PipelineSnapshot` and `projectPipelineSnapshot` in `pipeline-observation.ts`; add a focused
  `derivePipelineFinishedAtMs` helper colocated with projection.
- Pin projection and finish derivation in `daemon-pipeline-observation.test.ts` (active, succeeded
  with publication, failed/rejected without publication).
- Add guard-inversion comment checkpoints on pinning tests naming mutations on finish derivation and
  `createdAt` projection.
- Update `v2/docs/daemon-host.md` `pipeline_list` wire table and Pipeline snapshots section.

## Acceptance criteria

- [ ] Source-mutating each guard above (`createdAt` projection, publication-success finish, max-stage `endedAt` fallback) turns the corresponding pinning test RED. Do **not** add a production test flag. (Manual)

## Documentation updates
