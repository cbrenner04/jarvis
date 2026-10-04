# Pipeline snapshot ordering timestamps

Extend `pipeline_list` projection with pipeline `createdAt` and terminal finish time so the tree
model can order actives and terminals without inventing sort keys.

## Problem

`projectPipelineSnapshot` omits `createdAt` and terminal finish time. The tree model needs both for
ordering pins in [tui-overhaul-brief.md § Left pane — retention](../tui-overhaul-brief.md#left-pane--retention-fifo).

## Decisions

- Add `createdAt` (ms) and `finishedAtMs` (`number | null`) to `PipelineSnapshot` / `pipeline_list` — rules out sort keys derived from partial wire data or run rows.
- `finishedAtMs` is `null` for non-terminal derived states — rules out finish times on actives.
- Terminal `finishedAtMs` = `terminalPublicationSucceededAt` when set — rules out ignoring publication success.
- When `terminalPublicationSucceededAt` is unset on a terminal pipeline, `finishedAtMs` = max `endedAt` across durable stage rows — rules out pipeline-row-only timestamps that omit stage failure/reject settle.
- When a terminal pipeline has no publication timestamp and no stage `endedAt`, `finishedAtMs` = `pipeline.createdAt` — rules out `null` finish on terminals.
- Stage `startedAt`/`endedAt` are not projected in this slice — rules out pulling slice-3 elapsed wire forward.

## Tasks

- Extend `PipelineSnapshot` and `projectPipelineSnapshot` in `pipeline-observation.ts`; add a focused
  `derivePipelineFinishedAtMs` helper colocated with projection.
- Pin projection and finish derivation in `daemon-pipeline-observation.test.ts` (active, succeeded
  with publication, failed/rejected without publication, terminal with no stage `endedAt`).
- Add guard-inversion comment checkpoints on pinning tests naming mutations on finish derivation and
  `createdAt` projection.
- Update `v2/docs/daemon-host.md` `pipeline_list` wire table and Pipeline snapshots section.
- Update `v2/docs/v1-behaviors.md` for the `pipeline_list` snapshot shape change.

## Acceptance criteria

- [x] `daemon-pipeline-observation.test.ts` — `projectPipelineSnapshot` includes `createdAt` from the durable pipeline row and `finishedAtMs: null` while derived state is non-terminal; fails against the pre-fix projection.
- [x] `daemon-pipeline-observation.test.ts` — a terminal pipeline with `terminalPublicationSucceededAt` set projects that value as `finishedAtMs`; fails against the pre-fix projection.
- [x] `daemon-pipeline-observation.test.ts` — a terminal pipeline without publication success projects `finishedAtMs` as the max stage `endedAt`; returning `pipeline.createdAt` for finish turns the test RED.
- [x] `daemon-pipeline-observation.test.ts` — a terminal pipeline with no publication timestamp and no stage `endedAt` projects non-null `finishedAtMs` via `pipeline.createdAt` fallback; projecting `null` turns the test RED.
- [x] `daemon-pipeline-observation.test.ts` — pinning tests include comment checkpoints naming guard-inversion mutations for `createdAt` projection and terminal `finishedAtMs` derivation.
- [x] `v2/docs/daemon-host.md` documents `createdAt` and `finishedAtMs` on `pipeline_list` snapshots and the finish derivation rule.
- [x] `v2/docs/v1-behaviors.md` records `createdAt` and `finishedAtMs` on `pipeline_list` snapshots.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_list` response adds `createdAt` and `finishedAtMs` with finish derivation.
- `v2/docs/v1-behaviors.md` — `pipeline_list` snapshot shape adds `createdAt` and `finishedAtMs`.
