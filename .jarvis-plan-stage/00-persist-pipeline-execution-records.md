# Persist pipeline execution records

## Problem

- Workflow run rows cannot represent an admitted pipeline or an undispatched stage.

## Decisions

- `StateStore.createPipeline` writes one `pipelines` row and every authored stage row in one SQLite transaction; rules out partial admission.
- A pipeline row persists its generated identity, source definition name, and creation timestamp; rules out reconstructing pipeline identity from workflow runs.
- Each stage row has a generated immutable identity plus `(pipelineId, stageId)` uniqueness; rules out replacement across lifecycle transitions.
- Each stage row persists authored position explicitly and loads by that position; rules out relying on SQLite row order.
- New stage rows start `pending`; rules out treating admission as dispatch.
- Stage status persists losslessly as a string; rules out freezing a transition vocabulary before daemon execution exists.
- Deferred to first consumer: stage-status vocabulary beyond `pending` — pin when a caller needs it.
- Artifact and failure detail persist as nullable opaque JSON values; rules out freezing consumer-specific shapes.
- Deferred to first consumer: artifact value shape — pin when a caller needs it.
- Deferred to first consumer: failure-detail value shape — pin when a caller needs it.
- `StateStore` exposes only create, load-by-pipeline-ID, and stage-lifecycle update operations for this slice; rules out public SQL and speculative list/query APIs.
- Stage updates patch lifecycle fields in place under `(pipelineId, stageId)`; rules out replacing the row or rewriting sibling stages.

## Task checklist

- Add typed pipeline and stage records plus their minimal status contract to `v2/src/persistence/state-store.ts`.
- Add forward-only `pipelines` and `pipeline_stages` schema migration with durable stage identity, authored position, lifecycle fields, and parent linkage.
- Add transactional pipeline creation, pipeline loading with ordered stages, and targeted stage lifecycle updates.
- Add focused create, rollback, update-isolation, close, and reopen coverage in `v2/src/persistence/state-store.test.ts`.
- Update `v2/docs/state-store.md`.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` admits a validated multi-stage definition and reads one pipeline plus one `pending` stage per definition stage in authored order; the regression fails against the pre-change store.
- [ ] The regression forces a failure after at least one stage insert and proves the pipeline and all stage inserts roll back together.
- [ ] A stage lifecycle update preserves its durable row ID, pipeline ID, stage ID, and position; every sibling row remains unchanged.
- [ ] After closing and reopening the file-backed store, the regression reads the same pipeline identity, definition name, stage order, and populated workflow invocation ID, status, start/end timestamps, artifact, and failure detail.
- [ ] Tests fail when each added guard is inverted; negative cases cover rollback, authored ordering, nullable JSON fields, `(pipelineId, stageId)` targeting, and unchanged sibling rows.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/state-store.md` documents the pipeline and stage tables, fields, authored ordering, atomic creation, load operation, and in-place lifecycle update operation.

## Documentation updates

- `v2/docs/state-store.md` — pipeline and stage schema, ordering, atomic admission, and repository operations.
- `v2/docs/v1-behaviors.md` — no change; this is additive v2-only state.
