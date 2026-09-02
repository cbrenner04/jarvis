# State store baseline documentation

## Problem

`v2/docs/state-store.md` documents forward-only migrations as a per-id inventory (`004`–`030`). After the squash, operators and reviewers need the baselined schema and single pre-squash upgrade path documented; superseded per-migration prose should be retired.

## Decisions

- `state-store.md` is the durable home for baselined schema and upgrade-path semantics; rules out duplicating the full column inventory in spec prose.
- Retire the numbered migration inventory superseded by the baseline; rules out leaving stale `004`–`030` bullets that imply sequential ALTER review remains the contract.
- No `v1-behaviors.md` update — row load/save behavior is unchanged; rules out catalog churn for an internal schema representation swap.

## Prerequisites

- [02 - Squash state store migrations to baseline schema](./02-squash-state-store-migrations.md)

## Tasks

- [ ] Update `v2/docs/state-store.md` opening bootstrap paragraph to describe baselined `CREATE` for fresh stores and the single pre-squash upgrade path instead of "append migration statements when the first incompatible change lands."
- [ ] Replace the `Forward-only migrations:` inventory with baseline-schema documentation and a concise description of the one upgrade path from pre-squash stores (detection signal, preserved row semantics, no operator action required on open).
- [ ] Keep table/column semantics and API sections accurate against the baselined schema; adjust only migration-related prose.

## Acceptance criteria

- [ ] `v2/docs/state-store.md` documents the baselined schema as the durable contract and describes the single pre-squash upgrade path with no remaining per-migration `004`–`030` inventory bullets.

## Documentation updates

- `v2/docs/state-store.md` — document baselined schema and the single upgrade path from pre-squash stores; retire per-migration inventory prose superseded by the baseline.
