---
name: write-loop-split-implement-completion
---

# Implement completion and iteration-commit describes finish the monolith split

## Behavior

Move `describe("coverage advisory on implement write completion", …)` and `describe("per-iteration git commit on progress", …)` from `write-loop.test.ts` into co-located `write-loop-<area>.test.ts` siblings; leaf titles unchanged. After the move, `write-loop.test.ts` holds at most 120 tests and every `write-loop-<area>.test.ts` sibling introduced by this seed holds at most 120.

## Acceptance criteria

- [ ] Both describe groups run from siblings; `write-loop.test.ts` and each new split sibling respect the 120-test cap; inventory parity stays green.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

- None.

## Prerequisites

- Shared write-loop test helpers and fixtures live in `write-loop.test-support.ts` and `write-loop.test.ts` already imports them.
- Merge-base write-loop leaf-title inventory guard exists and passes on the pre-split monolith anchor.
- Top-level unit describes (`buildSubspecCompletionInventory`, `persistRetainedFinalizationCheckpoint`, `applyOperatorSessionId`) already run from sibling files.
- `external implement adapter read dirs and subspec access` and `findDraftContractRepromptStateFromLog` describe groups already run from sibling files.
- `work_boundary_recorded telemetry` and the ready-finalization shell cases before `ready-gate repair autofix` already run from sibling files.
- `ready-gate repair autofix`, `runBuiltInReadyGateAutofixBiome`, and `untouched-path gate settlement` describe groups already run from sibling files.
- `ready-gate repair fence`, `admitCoLocatedTestsOfAllowedPaths`, and `refusal revert preserves pre-repair dirt` describe groups already run from sibling files.
