---
name: write-loop-split-ready-gate-fence
---

# Ready-gate repair fence describes move to a sibling file

## Behavior

Move nested describes `ready-gate repair fence`, `admitCoLocatedTestsOfAllowedPaths`, and `refusal revert preserves pre-repair dirt` from `write-loop.test.ts` into one or more co-located `write-loop-<area>.test.ts` siblings grouped by `describe` area; leaf titles unchanged; each file ≤120 tests. Each sibling re-wraps moved blocks under `describe("write loop")` via `write-loop.test-support.ts` hook setup.

## Acceptance criteria

- [ ] Moved groups run from siblings; `v2/src/execution/write-loop-test-inventory.test.ts` stays green.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

- None.

## Prerequisites

- Shared write-loop test helpers, fixtures, and `describe("write loop")` hook setup live in `write-loop.test-support.ts` and `write-loop.test.ts` already imports them.
- `v2/src/execution/write-loop-test-inventory.test.ts` exists and passes on the pre-split monolith anchor.
- Top-level unit describes (`buildSubspecCompletionInventory`, `persistRetainedFinalizationCheckpoint`, `applyOperatorSessionId`) already run from sibling files.
- `external implement adapter read dirs and subspec access` and `findDraftContractRepromptStateFromLog` describe groups already run from sibling files.
- `work_boundary_recorded telemetry` and the ready-finalization shell cases before `ready-gate repair autofix` already run from sibling files.
- `ready-gate repair autofix`, `runBuiltInReadyGateAutofixBiome`, and `untouched-path gate settlement` describe groups already run from sibling files.
