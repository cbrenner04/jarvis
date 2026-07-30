# Enumerate durable pipelines

## Problem

- The state store can load only a known pipeline ID, so operator-facing consumers cannot discover admitted pipelines without direct SQL.

## Decisions

- Add `StateStore.listPipelines()` returning every admitted pipeline with its complete stage records; rules out daemon or CLI SQL and premature status filtering.
- Order each pipeline's stages by stored authored position; rules out insertion-order or cross-pipeline grouping.
- Return persisted pipeline and stage fields without deriving pipeline state; rules out persistence interpreting daemon-owned transitions.
- Deferred to first consumer: pipeline enumeration ordering, retention, and filters — pin when a daemon query contract needs them.

## Task checklist

- Add the typed pipeline enumeration operation to `v2/src/persistence/state-store.ts`.
- Add focused multi-pipeline, stage-association, authored-order, and reopen coverage to `v2/src/persistence/state-store.test.ts`.
- Update the repository contract and lifecycle-interpretation boundary in `v2/docs/state-store.md`.

## Acceptance criteria

- [ ] `StateStore.listPipelines()` returns every admitted pipeline, with each pipeline's complete stages in stored authored-position order; callers need no SQL and pipeline result order is unspecified.
- [ ] After close and reopen, enumeration preserves each stage's durable ID, pipeline association, status, and workflow invocation ID.
- [ ] The `v2/src/persistence/state-store.test.ts` regression `listPipelines enumerates multiple durable pipelines with ordered stages after reopen` fails against the pre-change store and passes after implementation.
- [ ] Removing or inverting the pipeline-to-stage association or authored-position ordering fails the regression; no stage appears under a sibling pipeline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/state-store.md` documents `listPipelines`, unspecified pipeline ordering/filtering, authored stage order, and that callers—not persistence—derive pipeline state.

## Documentation updates

- `v2/docs/state-store.md` — pipeline enumeration repository contract and lifecycle-interpretation boundary.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only repository behavior.
