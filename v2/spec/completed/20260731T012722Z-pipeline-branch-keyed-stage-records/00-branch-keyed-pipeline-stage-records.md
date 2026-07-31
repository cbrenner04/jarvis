# Branch-keyed pipeline stage records

## Problem

`pipeline_stages` is one row per `(pipeline_id, stage_id)`. A splitting intent needs independent lifecycle, artifact, and gate state per ready-intent branch with no cross-branch overwrite.

## Decisions

- Durable stage rows are keyed by `(stageId, branchKey)` — rules out one row per `stageId` and implicit default-only branching.
- `branch_key` is `NOT NULL`; migration `020` backfills existing rows with `"default"` — rules out null keys and path-derived backfill before fan-out lands.
- Replace `UNIQUE (pipeline_id, stage_id)` with `UNIQUE (pipeline_id, stage_id, branch_key)` — rules out collapsing branches in storage.
- Drop `UNIQUE (pipeline_id, position)`; branch siblings for the same authored stage share `position` — rules out one position slot per pipeline.
- `loadPipeline` / `listPipelines` order stages by `position ASC`, then `branch_key ASC` with `"default"` first among position ties — rules out ambiguous sibling ordering once branches exist.
- `createPipeline` admits one `branchKey: "default"` row per authored stage — rules out multi-branch admission in this slice.
- `createPipelineStageBranch({ pipelineId, stageId, branchKey })` admits explicit additional rows at the fan-out boundary — rules out implicit branch creation during reads or updates. Contract: initial row is `pending` with null lifecycle fields (matching admitted stages); copies the default sibling's `position` for that `stageId`; applies to workflow and approval rows; refuses duplicate `(pipelineId, stageId, branchKey)` and unknown `pipelineId`/`stageId` with explicit constraint-backed errors; returns the new row's durable `id` like `createPipeline`.
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
- [ ] Update `STAGE_COLUMNS` and stage row mapping for `branchKey`.
- [ ] Order `loadPipeline` / `listPipelines` stage queries by `position ASC`, then `branch_key ASC` with `"default"` first among position ties.
- [ ] Update the enumeration preservation test fixture SQL for `branch_key` and secondary-sort expectations.
- [ ] Forward new/changed `StateStore` members from every complete test double (including `v2/src/execution/write-loop.test.ts`).
- [ ] Add branch-row, `createPipelineStageBranch`, multi-input artifact, and migration-upgrade coverage to `v2/src/persistence/state-store.test.ts`.
- [ ] Update `v2/docs/state-store.md`, `v2/docs/daemon-host.md` § Pipeline stage resolution, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `state-store.test.ts` — two branch rows for the same `stageId` persist distinct `branchKey`, status, and artifact payloads; the non-default row is created via `createPipelineStageBranch`; collapsing to one row per `stageId` makes the test fail.
- [x] `state-store.test.ts` — inverting the branch-row guard (duplicate `branchKey`, unknown `stageId`, a `createPipelineStageBranch` stub that always throws, or missing second row) makes the branch-key test fail.
- [x] `state-store.test.ts` — a stage artifact with two downstream-input file paths round-trips through write and read; storing only one path or a directory path makes the test fail.
- [x] `state-store.test.ts` — inverting the two-path guard (single path, directory path, or omitted `downstreamInputs`) makes the artifact round-trip test fail.
- [x] `state-store.test.ts` — a pre-019 fixture with `pipeline_stages` rows upgrades through `020`, backfills `branch_key = 'default'`, enforces `UNIQUE (pipeline_id, stage_id, branch_key)`, and can load pipelines afterward; missing backfill or retaining `UNIQUE (pipeline_id, stage_id)` makes the test fail.
- [x] `state-store.test.ts` — `listPipelines enumerates complete durable active and interrupted pipelines with ordered stages after reopen` stays green (default-branch behavior unchanged; fixture SQL and enumeration expectations include `branch_key` and position-tie ordering with `"default"` first).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- [x] `v2/docs/state-store.md` — `branch_key` column, revised uniqueness, `createPipelineStageBranch`, `updateStage` branch targeting, secondary stage ordering, and that enumeration returns one entry per stored row (row count may exceed authored stage count when branches exist).
- [x] `v2/docs/daemon-host.md` § Pipeline stage resolution — persistence may store `downstreamInputs`; stage resolution and dispatch still use today's `specPath`/single-input behavior until downstream-handoff/fan-out land.
- [x] `v2/docs/v1-behaviors.md` — record branch-keyed pipeline stage persistence and that current execution still targets the default branch only.
