---
name: write-loop-split-work-boundary-and-ready-shell
---

# Work-boundary telemetry and ready-finalization shell move out of the monolith

## Behavior

Move `describe("work_boundary_recorded telemetry", …)` and the outer `describe("ready finalization", …)` cases that precede the nested `describe("ready-gate repair autofix", …)` block (everything under `ready finalization` before that nested describe opens) into co-located `write-loop-<area>.test.ts` siblings; leaf titles unchanged; each file ≤120 tests. Each sibling re-wraps moved integration describes under `describe("write loop")` via `write-loop.test-support.ts` hook setup. Leave the core five `write loop` smoke tests and the monolith’s `beforeEach`/`afterEach` in `write-loop.test.ts`.

## Acceptance criteria

- [ ] Moved groups run from siblings; core `write loop` smoke tests remain in `write-loop.test.ts`; `v2/src/execution/write-loop-test-inventory.test.ts` stays green.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

- None.

## Prerequisites

- Shared write-loop test helpers, fixtures, and `describe("write loop")` hook setup live in `write-loop.test-support.ts` and `write-loop.test.ts` already imports them.
- `v2/src/execution/write-loop-test-inventory.test.ts` exists and passes on the pre-split monolith anchor.
- Top-level unit describes (`buildSubspecCompletionInventory`, `persistRetainedFinalizationCheckpoint`, `applyOperatorSessionId`) already run from sibling files.
- `external implement adapter read dirs and subspec access` and `findDraftContractRepromptStateFromLog` describe groups already run from sibling files.
