---
name: squash-state-store-migrations
---

# Squash state store migrations to a baseline schema

## Primary implementation surface

Persistence

## Prerequisites

## Problem

Twenty-eight sequential SQLite migrations in `state-store.ts` add review drag on a single-machine store. Persistence also carries local `isRecord` and shrink-suffix literals in `workflow-run-status-rollup.ts`, and the default SQLite path is re-derived inline instead of through `paths.ts`.

## Behavior

- Replace the sequential ALTER chain with one baselined `CREATE` schema plus a single upgrade path from pre-squash databases.
- Export the default store path from `paths.ts` and migrate persistence call sites off inline `join(jarvisHome(), "state", "v2.sqlite")`.
- Add `shared/is-record.ts` exporting `isRecord` and `shared/shrink-step-id.ts` exporting the hidden-shrink step-id suffix constant plus `endsWith`/`strip` helpers; migrate persistence-local copies there and delete inline definitions.

## Decision ledger

- Squash to baseline `CREATE` plus one tested upgrade from a pre-squash fixture; rules out carrying 28 forward-only ALTERs indefinitely.
- `isRecord` and shrink step-id suffix live only in `shared/is-record.ts` and `shared/shrink-step-id.ts`; rules out unnamed helper homes or duplicate persistence-local definitions.
- Default SQLite path lives in `paths.ts`; rules out re-deriving the store path by hand in persistence code.
- Behavior-preserving: row load/save semantics unchanged; rules out schema cleanup that silently reshapes operator data.

## Acceptance criteria

- [ ] A migration test opens a pre-squash fixture database and a fresh database through `openStateStore` and proves equivalent row visibility for representative runs, pipelines, and stages; it fails against the pre-fix sequential migration chain.
- [ ] `v2/src/persistence/state-store.test.ts` legacy-migration and terminal-settlement fixture tests stay green after the squash.
- [ ] Grep finds no remaining sequential migration statements in the `state-store.ts:791-928` migration block style; the baseline schema is the durable contract.
- [ ] `state-store.ts` and `workflow-run-status-rollup.ts` import `isRecord` from `shared/is-record.ts` and shrink step-id helpers from `shared/shrink-step-id.ts` with no local duplicate definitions.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — document baselined schema and the single upgrade path from pre-squash stores; retire per-migration inventory prose superseded by the baseline.
