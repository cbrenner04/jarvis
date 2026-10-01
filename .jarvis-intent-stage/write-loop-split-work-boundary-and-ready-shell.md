---
name: write-loop-split-work-boundary-and-ready-shell
---

# Work-boundary telemetry and ready-finalization shell move out of the monolith

## Behavior

Move `describe("work_boundary_recorded telemetry", …)` and the outer `describe("ready finalization", …)` cases that sit before the nested `ready-gate repair autofix` block (merge-base line region through the start of that nested describe) into co-located `write-loop-<area>.test.ts` siblings; leaf titles unchanged; each file ≤120 tests. Leave the core five `write loop` smoke tests and shared `beforeEach`/`afterEach` in `write-loop.test.ts`.

## Acceptance criteria

- [ ] Moved groups run from siblings; core `write loop` smoke tests remain in `write-loop.test.ts`; inventory parity stays green.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

- None.

## Prerequisites

- Shared write-loop test helpers and fixtures live in `write-loop.test-support.ts` and `write-loop.test.ts` already imports them.
- Merge-base write-loop leaf-title inventory guard exists and passes on the pre-split monolith anchor.
- Top-level unit describes (`buildSubspecCompletionInventory`, `persistRetainedFinalizationCheckpoint`, `applyOperatorSessionId`) already run from sibling files.
- `external implement adapter read dirs and subspec access` and `findDraftContractRepromptStateFromLog` describe groups already run from sibling files.
