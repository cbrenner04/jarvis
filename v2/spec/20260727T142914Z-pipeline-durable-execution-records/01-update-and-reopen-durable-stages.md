# Update and reopen durable stages

## Problem

- A durable admitted stage needs a deterministic lifecycle record without replacing its identity or changing sibling rows.

## Decisions

- `StateStore` exposes targeted lifecycle updates under `(pipelineId, stageId)`; unknown pipelines or stages, and empty updates, reject rather than silently succeeding.
- An update is a nonempty patch: omitted lifecycle fields remain unchanged; explicit `null` clears nullable `workflowInvocationId`, timestamps, artifact, or failure detail. `status` is a non-null string.
- `startedAt` and `endedAt` are Unix epoch milliseconds. New rows initialize those fields, workflow linkage, artifact, and failure detail to `null`.
- Stage status is stored losslessly as a string. This slice enforces persistence semantics, not a post-`pending` transition policy; the future daemon consumer defines the status vocabulary and allowed transitions.
- Lifecycle updates modify the existing stage row only. Artifact and failure-detail JSON envelopes remain schema-free values as defined by admission; no consumer-specific representation is chosen here.

## Task checklist

- Add the targeted stage-lifecycle patch operation and its typed input/output to `v2/src/persistence/state-store.ts`.
- Add focused lifecycle update, clear-versus-omit, unknown-target, sibling-isolation, close, and reopen coverage in `v2/src/persistence/state-store.test.ts`.
- Update `v2/docs/state-store.md`.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` updates one admitted stage and preserves its durable row ID, pipeline ID, stage ID, and position while every sibling remains unchanged; the regression fails against the pre-change store.
- [ ] Lifecycle patches retain omitted fields, clear nullable fields when passed explicit `null`, reject an empty patch and an unknown `(pipelineId, stageId)`, and round-trip millisecond timestamps plus a non-null status string without imposing post-`pending` transition rules.
- [ ] After closing and reopening a file-backed store, the regression reads the same pipeline identity, definition name and snapshot, stage order, and populated workflow snapshot `invocationId`, status, start/end timestamps, artifact, and failure detail.
- [ ] The update regressions fail when target rejection or sibling-update isolation is removed.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/state-store.md` documents the pipeline and stage tables, immutable definition snapshot, fields and initial nulls, derived pipeline status, authored ordering, atomic admission, load operation, in-place lifecycle update operation, workflow snapshot linkage, and schema-free artifact/failure envelopes.

## Documentation updates

- `v2/docs/state-store.md` — pipeline and stage schema, admission/load/update operations, lifecycle semantics, and restart contract.
- `v2/docs/v1-behaviors.md` — no change; this is additive v2-only state.
