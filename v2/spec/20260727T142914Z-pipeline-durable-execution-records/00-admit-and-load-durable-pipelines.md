# Admit and load durable pipelines

## Problem

- Workflow run rows cannot represent an admitted pipeline or an undispatched stage.

## Decisions

- `StateStore.createPipeline` accepts a definition that the caller has already passed through `validatePipelineDefinition`; validation remains a pre-admission boundary and `createPipeline` does not introduce a second validation type or validator.
- Admission writes one pipeline and every authored stage in one SQLite transaction; a deterministic test-only insertion fault proves rollback after a prior stage insert without using an invalid definition.
- A pipeline persists its generated identity, source definition name, creation timestamp, and an immutable admitted-definition snapshot. Reopening uses that snapshot, not a changed live definition, to retain executable meaning.
- Pipeline lifecycle status is derived by later consumers from its stage rows; this slice stores no authoritative pipeline-status field.
- Every stage has a generated immutable ID, an enforced parent relationship to its pipeline, and unique `(pipelineId, stageId)` and `(pipelineId, position)` keys. Positions are authored indices and loads sort by them.
- Admission creates `pending` stages with `workflowInvocationId`, `startedAt`, `endedAt`, artifact, and failure detail all `null`.
- A stage's `workflowInvocationId` is the existing workflow snapshot `invocationId`, nullable for undispatched and approval stages; it is not a workflow-run-row reference and has no run-row foreign key.
- Artifact and failure detail use nullable JSON envelopes only to losslessly round-trip caller values through SQLite. The envelopes define no artifact or failure schema; semantic shape remains deferred to the first daemon consumer.

## Task checklist

- Add typed pipeline and admission-stage records to `v2/src/persistence/state-store.ts`, including the immutable admitted-definition snapshot and initial lifecycle values.
- Add forward-only `pipelines` and `pipeline_stages` migration with parent, stage-ID, and authored-position integrity.
- Add transactional creation and load-by-pipeline-ID operations.
- Add focused admission, authored-order, partial-insert rollback, relational-integrity, and legacy-upgrade coverage in `v2/src/persistence/state-store.test.ts`.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` admits an already validated multi-stage definition and reads one pipeline plus one `pending` stage per authored stage in authored order; the regression fails against the pre-change store.
- [ ] The admitted pipeline reads its original definition name and immutable definition snapshot after the live source definition is changed, and has no stored pipeline lifecycle status.
- [ ] A deterministic failure after at least one valid stage insert leaves neither its pipeline row nor any of its stage rows committed.
- [ ] The store rejects duplicate stage IDs or duplicate authored positions within one pipeline, rejects a stage whose parent pipeline is absent, and preserves ordering by stored position rather than insertion order.
- [ ] A fixture created with the pre-change migrations upgrades without losing existing runs, attempts, or migration history; it can then admit and load a pipeline, and a further reopen is idempotent.
- [ ] The admission regressions fail when transaction rollback, parent/unique integrity, or position ordering is removed.

## Documentation updates

- No standalone update: `01-update-and-reopen-durable-stages.md` documents the complete pipeline and stage repository surface after both slices land.
