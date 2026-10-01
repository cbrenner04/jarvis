# Move standalone unit describes

## Problem

Three top-level `describe` blocks (`buildSubspecCompletionInventory`, `persistRetainedFinalizationCheckpoint`, `applyOperatorSessionId`) sit outside `describe("write loop")` and should become a co-located sibling without the write-loop hook wrapper.

## Surface

Primary: `v2/src/execution/write-loop-standalone-units.test.ts` (new), `v2/src/execution/write-loop.test.ts` (removals/imports).

## Prerequisites

- Subspec 01 complete: inventory guard passes on the current title set.

## Decision ledger

- Move the three top-level describes unchanged into `write-loop-standalone-units.test.ts`; rules out leaving any of them in `write-loop.test.ts`.
- Import shared helpers from `write-loop.test-support.ts` only; no `describe("write loop")` wrapper; rules out duplicating hook setup on unit suites.
- Leaf test titles unchanged; rules out renames that would break mutation killing-set resolution (`<stem>-*.test.ts` siblings already included).

## Task checklist

- Create `write-loop-standalone-units.test.ts` with the three describes and their tests moved verbatim aside from import paths.
- Remove the moved blocks from `write-loop.test.ts`.
- Ensure `write-loop-test-inventory.test.ts` still passes.

## Acceptance criteria

- [ ] `write-loop.test.ts` and `write-loop-standalone-units.test.ts` stay green (behavior unchanged by the move).
- [ ] `write-loop-test-inventory.test.ts` passes.
- [ ] `bun run typecheck` and `bun run check` pass.
- [ ] None of `describe("buildSubspecCompletionInventory")`, `describe("persistRetainedFinalizationCheckpoint")`, or `describe("applyOperatorSessionId")` remain in `write-loop.test.ts`.

## Documentation updates

None.
