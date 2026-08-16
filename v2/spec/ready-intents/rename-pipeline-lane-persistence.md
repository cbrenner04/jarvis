---
name: rename-pipeline-lane-persistence
---

# Rename Pipeline Lane Persistence

## Prerequisites

## Surface

Persistence.

## Problem

- Pipeline stage storage calls fan-out lanes branches, keeping the misleading `branchKey` vocabulary in types and schema.

## Behavior

- State-store lane identity is `laneKey` backed by `lane_key`; opening a legacy store renames its `branch_key` columns once while preserving every row, lane value, and default-first position-tie order.

## Decisions

- Rename state-store lane identifiers and every durable pipeline lane-key column in one appended ledgered migration; rules out a mixed-vocabulary schema or compatibility alias layer.
- Keep `default` and fan-out lane values byte-for-byte unchanged; rules out a data rewrite coupled to the identifier rename.

## Required verification

- A migration test opens a pre-rename fixture database and pins one-time migration, row preservation, unchanged values, and default-first position-tie order.
- State-store tests use `laneKey` and `lane_key` exclusively for pipeline lane identity.

## Documentation updates

- `v2/docs/state-store.md` — canonical `laneKey`/`lane_key` contract and legacy-store migration.
- `v2/docs/v1-behaviors.md` — renamed durable pipeline lane identity and preserved values/order.
