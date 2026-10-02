# Move external implement and draft reprompt describes

## Problem

The `external implement adapter read dirs and subspec access` and `findDraftContractRepromptStateFromLog` groups are large integration slices inside `describe("write loop")` and belong in a dedicated sibling under the shared hook contract.

## Surface

Primary: `v2/src/execution/write-loop-external-and-draft-reprompt.test.ts` (new), `v2/src/execution/write-loop.test.ts`.

## Prerequisites

- Subspec 02 complete.

## Decision ledger

- New sibling wraps both describes under `describe("write loop")` using the exported hook registrar from `write-loop.test-support.ts`; rules out omitting the `./write.ts` mock contract on integration paths.
- Move both nested describes with leaf titles unchanged; rules out splitting them across unrelated stems.
- Target file stem `write-loop-external-and-draft-reprompt.test.ts`; rules out overloading `write-loop.test.ts` as the container for these groups after this slice.

## Task checklist

- Add `write-loop-external-and-draft-reprompt.test.ts` with outer `describe("write loop")`, hooks, and the two nested describes moved from `write-loop.test.ts`.
- Remove the moved blocks from `write-loop.test.ts`.

## Acceptance criteria

- [x] `write-loop.test.ts` and `write-loop-external-and-draft-reprompt.test.ts` stay green (behavior unchanged by the move).
- [x] `write-loop-test-inventory.test.ts` passes.
- [x] `bun run typecheck` and `bun run check` pass.
- [x] `describe("external implement adapter read dirs and subspec access")` and `describe("findDraftContractRepromptStateFromLog")` run only from `write-loop-external-and-draft-reprompt.test.ts`, not from `write-loop.test.ts`.

## Documentation updates

None.
