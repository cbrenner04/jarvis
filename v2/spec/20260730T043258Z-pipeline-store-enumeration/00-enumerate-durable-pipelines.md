# Enumerate durable pipelines

## Problem

- The state store can load only a known pipeline ID, so operator-facing consumers cannot discover admitted pipelines without direct SQL.

## Decisions

- Add `StateStore.listPipelines()` returning every admitted pipeline, including persisted `active` and `interrupted` pipelines, with its complete stage records; rules out daemon or CLI SQL and status filtering.
- Order each pipeline's stages by stored authored position; rules out insertion-order or cross-pipeline grouping.
- Return each persisted pipeline and stage field, including nullable ownership, lifecycle, artifact, and failure metadata, without deriving execution progress; rules out persistence interpreting daemon-owned transitions.
- Enumeration has no snapshot-consistency guarantee against concurrent writes; define one when a consumer needs it.
- An empty store returns an empty collection; each admitted pipeline and its stages appear exactly once.
- Deferred to first consumer: pipeline enumeration ordering, retention, and filters — pin when a daemon query contract needs them.

## Task checklist

- Add the typed pipeline enumeration operation to `v2/src/persistence/state-store.ts`.
- Add focused empty-store, multi-pipeline, status, association, authored-order, and reopen coverage to `v2/src/persistence/state-store.test.ts`.
- Update the repository contract, concurrent-read deferral, and lifecycle-interpretation boundary in `v2/docs/state-store.md`.

## Acceptance criteria

- [ ] `StateStore.listPipelines()` returns an empty collection for an empty store, then every admitted `active` and `interrupted` pipeline exactly once, with each associated stage exactly once in stored authored-position order; callers need no SQL and pipeline result order is unspecified.
- [ ] After close and reopen, enumeration preserves complete persisted pipeline and stage records, including IDs, association, definition, reconciliation status, nullable ownership and lifecycle metadata, workflow invocation IDs, artifacts, and failure details.
- [ ] The `v2/src/persistence/state-store.test.ts` regression `listPipelines enumerates complete durable active and interrupted pipelines with ordered stages after reopen` fails against the pre-change store and passes after implementation.
- [ ] Omitting, duplicating, or misassociating a pipeline or stage, or inverting authored-position ordering, fails the regression; no stage appears under a sibling pipeline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/state-store.md` documents `listPipelines`, empty/exactly-once collection semantics, unspecified pipeline ordering/filtering and concurrent-write snapshot consistency, authored stage order, and persisted `active`/`interrupted` reconciliation status; it corrects the claim that no pipeline-level status is stored and preserves that callers—not persistence—derive execution progress.

## Documentation updates

- `v2/docs/state-store.md` — pipeline enumeration contract, concurrent-read deferral, persisted reconciliation status, and lifecycle-interpretation boundary.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only repository behavior.
