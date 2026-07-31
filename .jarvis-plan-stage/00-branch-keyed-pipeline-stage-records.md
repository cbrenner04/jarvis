# Branch-keyed pipeline stage records

## Problem

`pipeline_stages` is one row per `(pipeline_id, stage_id)`. A splitting intent needs independent lifecycle, artifact, and gate state per ready-intent branch with no cross-branch overwrite.

## Decisions

- Durable stage rows are keyed by `(stageId, branchKey)` — rules out one row per `stageId` and implicit default-only branching.
- `branch_key` is `NOT NULL`; migration `020` backfills existing rows with `"default"` — rules out null keys and path-derived backfill before fan-out lands.
- Replace `UNIQUE (pipeline_id, stage_id)` with `UNIQUE (pipeline_id, stage_id, branch_key)` — rules out collapsing branches in storage.
- Drop `UNIQUE (pipeline_id, position)`; branch siblings for the same authored stage share `position` — rules out one position slot per pipeline.
- `createPipeline` admits one `branchKey: "default"` row per authored stage — rules out multi-branch admission in this slice.
- Add `createPipelineStageBranch({ pipelineId, stageId, branchKey })` for explicit additional rows at the fan-out boundary — rules out implicit branch creation during reads or updates.
- `updateStage` targets `(pipelineId, stageId, branchKey)`; omitted `branchKey` defaults to `"default"` — rules out `stageId`-only updates that hit the wrong branch.
- `listPipelines` / `loadPipeline` return every branch row without collapsing — rules out merged reads.
- Persisted stage artifact JSON may include `downstreamInputs: string[]` of worktree-relative ready-intent **file** paths — rules out `specPath`-only envelopes and directory handoff values for splits.
- This slice does not change daemon fan-out, dispatch, or resolution — rules out absorbing execution-loop logic here.
- Deferred to fan-out execution: stable path-derived `branchKey` for new branches beyond `"default"`.
- Deferred to first consumer: rewriting legacy `specPath`-only artifact JSON to `downstreamInputs` — pin when dispatch or resolution reads multi-input artifacts.

## Prerequisites

- Durable pipeline stage records, approval gates, and `pipeline list` / `wait` / `approve` / `reject` / `resume` exist.
- Inter-stage handoff resolves chained inputs from the prior entry-run worktree.
- Intent completion records a concrete ready-intent file on the entry run and stage artifact when landing produces exactly one ready-intent file; the ready-intents directory when landing produces more than one.

## Task checklist

- [ ] Migration `020`: add `branch_key`, backfill `"default"`, replace uniqueness constraints.
- [ ] Extend `PipelineStageRecord`, `createPipeline`, `createPipelineStageBranch`, `updateStage`, `loadPipeline`, and `listPipelines` in `v2/src/persistence/state-store.ts`.
- [ ] Forward new/changed `StateStore` members from every complete test double.
- [ ] Add branch-row and multi-input artifact coverage to `v2/src/persistence/state-store.test.ts`.
- [ ] Update `v2/docs/state-store.md`, `v2/docs/daemon-host.md` § Pipeline stage resolution, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `state-store.test.ts` — two branch rows for the same `stageId` persist distinct `branchKey`, status, and artifact payloads; collapsing to one row per `stageId` makes the test fail.
- [ ] `state-store.test.ts` — inverting the two-row guard (duplicate `branchKey` or missing second row) makes the branch-key test fail.
- [ ] `state-store.test.ts` — a stage artifact with two downstream-input file paths round-trips through write and read; storing only one path or a directory path makes the test fail.
- [ ] `state-store.test.ts` — inverting the two-path guard (single path, directory path, or omitted `downstreamInputs`) makes the artifact round-trip test fail.
- [ ] `state-store.test.ts` — `listPipelines enumerates complete durable active and interrupted pipelines with ordered stages after reopen` stays green (default-branch behavior unchanged).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- [ ] `v2/docs/state-store.md` — `branch_key` column, revised uniqueness, `createPipelineStageBranch`, and `updateStage` branch targeting.
- [ ] `v2/docs/daemon-host.md` § Pipeline stage resolution — stage artifacts may carry multiple downstream inputs; durable records are keyed by branch.
- [ ] `v2/docs/v1-behaviors.md` — record branch-keyed pipeline stage persistence.
