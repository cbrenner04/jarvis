# Persist pipeline execution context

## Problem

- Pipeline rows omit the immutable admission context needed to resolve a later stage after restart.

## Decisions

- Persist the admitted `PipelineContext` as an immutable JSON snapshot on the pipeline row; rules out rebuilding
  later-stage input from workflow rows or a continuing client.
- Load pre-context pipeline rows with no context rather than synthesizing one; rules out guessing admission input
  during migration.

## Task checklist

- Add a forward migration and typed pipeline context persistence to the state store.
- Add focused persistence and migration coverage.
- Update durable-persistence docs.

## Acceptance criteria

- [ ] Closing and reopening the store preserves the complete immutable admitted `PipelineContext`; mutating the
      caller's source context after admission does not change the stored snapshot.
- [ ] A database from before the context migration opens successfully and loads legacy pipeline context as absent.
- [ ] A new or updated `v2/src/persistence/state-store.test.ts` regression for snapshot persistence and legacy
      rows fails against the pre-fix store behavior.
- [ ] Inverting any added context-presence or legacy-fallback guard makes its targeted regression fail; negative
      cases prove absent legacy context is not synthesized.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/state-store.md` documents the context schema, immutable snapshot contract, and legacy-row behavior.
- [ ] `v2/docs/v1-behaviors.md` records the additive v2 persisted-context behavior.

## Documentation updates

- `v2/docs/state-store.md` — context schema, migration, snapshot, and repository contract.
- `v2/docs/v1-behaviors.md` — additive v2 persisted-context behavior.
