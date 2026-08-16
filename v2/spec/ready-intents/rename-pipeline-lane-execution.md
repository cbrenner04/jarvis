---
name: rename-pipeline-lane-execution
---

# Rename Pipeline Lane Execution

## Prerequisites

- State-store lane identity is `laneKey` backed by `lane_key`; legacy `branch_key` stores migrate without row, value, or order changes.

## Surface

Execution loop.

## Problem

- Pipeline fan-out, dispatch, resolution, settlement, and approval targeting call lanes branches, reinforcing confusion with workflow git branches.

## Behavior

- Pipeline execution uses lane terminology end to end, keeps `default` and ready-intent-basename lane values unchanged, requires `laneKey` for a multi-lane approval stage with refusal `lane_key_required`, and names valid lanes when a supplied lane does not match.

## Decisions

- Rename execution identifiers instead of adapting renamed persistence through branch-named locals; rules out an internal vocabulary split.
- Refuse an invalid supplied lane with its valid lane set; rules out a generic missing-stage refusal that leaves operators guessing.

## Required verification

- Pipeline execution tests pin default and fan-out progression through `laneKey`, `lane_key_required` for omitted multi-lane approval targeting, and valid-lane detail for a mismatched target.
- Existing fan-out concurrency, isolation, settlement, and default-first behavior remain pinned under lane terminology.

## Documentation updates

- `v2/docs/daemon-host.md` — lane-keyed fan-out execution, approval targeting, and valid-lane refusal semantics.
- `v2/docs/v1-behaviors.md` — pipeline execution's lane vocabulary and unchanged lane values.
