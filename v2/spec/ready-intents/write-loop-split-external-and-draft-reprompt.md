---
name: write-loop-split-external-and-draft-reprompt
---

# External-implement and draft-contract reprompt describes become siblings

## Behavior

Move the nested `describe("external implement adapter read dirs and subspec access", …)` and `describe("findDraftContractRepromptStateFromLog", …)` blocks from `write-loop.test.ts` into co-located `write-loop-<area>.test.ts` siblings; leaf titles unchanged; each file ≤120 tests. Each sibling re-wraps moved blocks under `describe("write loop")` using the shared hook setup from `write-loop.test-support.ts` (same `./write.ts` mock contract as the monolith).

## Acceptance criteria

- [ ] Both describe groups execute from new siblings; `v2/src/execution/write-loop-test-inventory.test.ts` stays green.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

- None.

## Prerequisites

- Shared write-loop test helpers, fixtures, and `describe("write loop")` hook setup live in `write-loop.test-support.ts` and `write-loop.test.ts` already imports them.
- `v2/src/execution/write-loop-test-inventory.test.ts` exists and passes on the pre-split monolith anchor.
- Top-level unit describes (`buildSubspecCompletionInventory`, `persistRetainedFinalizationCheckpoint`, `applyOperatorSessionId`) already run from sibling files.
