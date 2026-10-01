---
name: write-loop-split-subspec-and-checkpoints
---

# Top-level write-loop unit describes move to siblings

## Problem

The monolith mixes pure unit `describe` blocks with the heavy `write loop` integration harness; the first split slice must shrink the file without touching ready-gate bulk.

## Behavior

Move these file-top `describe` blocks out of `write-loop.test.ts` into co-located `write-loop-<area>.test.ts` siblings, titles unchanged: `buildSubspecCompletionInventory`, `persistRetainedFinalizationCheckpoint`, and `applyOperatorSessionId`. They are not nested under `describe("write loop")`; siblings need no write-loop hook wrapper. Each resulting file holds at most 120 tests.

## Acceptance criteria

- [ ] The three describe groups run from their new sibling files; leaf titles match merge-base.
- [ ] `v2/src/execution/write-loop-test-inventory.test.ts` stays green.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

- None.

## Prerequisites

- Shared write-loop test helpers and fixtures live in `write-loop.test-support.ts` and `write-loop.test.ts` already imports them.
- `v2/src/execution/write-loop-test-inventory.test.ts` exists and passes on the pre-split monolith anchor.
