# Squash state store migrations to baseline schema

## Problem

`state-store.ts` carries twenty-seven forward-only `SCHEMA_MIGRATIONS` entries (`004`–`030`) atop a minimal bootstrap `SCHEMA`. Every new column review walks the full ALTER chain. Fresh databases should open on one baselined `CREATE`; operator stores already at any pre-squash migration epoch need one tested upgrade, not perpetual sequential review.

## Decisions

- Replace bootstrap `SCHEMA` plus `SCHEMA_MIGRATIONS` with one baselined `CREATE` matching post-`030` on-disk shape; rules out carrying the sequential ALTER inventory forward indefinitely.
- Fresh opens apply only the baseline `CREATE` (plus existing WAL / foreign-key setup); rules out re-running historical `004`–`030` ALTERs on empty files.
- Pre-squash stores upgrade through exactly one new migration entry recorded in `_migrations`; rules out leaving multiple review-facing migration steps after squash.
- The single upgrade must open every partial and complete pre-squash fixture already constructed in `state-store.test.ts` (legacy-migration, terminal-settlement, pipeline-context, branch-key, dismissed-at, and related tests); rules out an upgrade that only handles fully-migrated operator files.
- Row load/save semantics and column nullability/backfill behavior stay identical to today's post-`030` store; rules out schema cleanup that silently reshapes operator data.
- Retire `SCHEMA_MIGRATIONS` and its per-migration loop from review surface; the baselined `CREATE` plus the one upgrade path are the durable contract.

## Prerequisites

- [00 - Shared isRecord and shrink step-id helpers](./00-shared-is-record-and-shrink-step-id.md)
- [01 - Orchestration store path constant](./01-orchestration-store-path.md)

## Tasks

- [ ] Replace bootstrap `SCHEMA` / `SCHEMA_MIGRATIONS` with a baselined `CREATE` for all orchestration tables at post-`030` shape.
- [ ] Implement one pre-squash upgrade path (detect legacy `_migrations` era, apply consolidated upgrade SQL, stamp the squash migration id).
- [ ] Add `v2/src/persistence/state-store-baseline-migration.test.ts` with a committed or programmatically built pre-squash fixture at migration `030` and representative run, pipeline, and stage rows; open through `openStateStore`, load the same entities from a fresh baseline database seeded with equivalent rows, and assert equivalent row visibility.
- [ ] Keep existing legacy-migration and terminal-settlement fixture construction in `state-store.test.ts` working against the new upgrade path without rewriting their behavioral assertions.

## Acceptance criteria

- [x] `state-store-baseline-migration.test.ts` opens a pre-squash fixture database and a fresh baseline database through `openStateStore` and asserts equivalent row visibility for representative runs, pipelines, and stages; it fails against the pre-fix sequential `SCHEMA_MIGRATIONS` chain reachable in `state-store.ts`.
- [x] `state-store.test.ts` legacy-migration fixture tests stay green.
- [x] `state-store.test.ts` terminal-settlement fixture tests stay green.
- [x] `state-store.ts` exposes no `SCHEMA_MIGRATIONS` sequential ALTER chain; the baselined `CREATE` is the durable schema contract for fresh stores.

## Documentation updates

Deferred to [03 - State store baseline documentation](./03-state-store-baseline-docs.md).
