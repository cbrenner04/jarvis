---
name: write-loop-test-inventory
---

# Write-loop split preserves merge-base leaf test titles

## Problem

Splitting `write-loop.test.ts` by `describe` risks dropping or renaming leaf cases without a durable guard; missing-only parity against merge-base leaf titles is enough (surplus destination titles are allowed, same contract as `workflow-runner-resume-inventory.test.ts`).

## Behavior

Add `v2/src/execution/write-loop-test-inventory.test.ts` (same pattern as `workflow-runner-resume-inventory.test.ts`) that anchors merge-base `v2/src/execution/write-loop.test.ts` leaf titles and asserts missing-only parity across every owned `write-loop*.test.ts` file co-located with `write-loop.ts` (`write-loop.test.ts` and new `write-loop-<area>.test.ts` siblings from this split; exclude unrelated stems such as `write-loop-input` and pre-existing extractions like `write-loop-intent-landing`). Surplus titles in destinations are allowed; missing merge-base titles fail.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop-test-inventory.test.ts` fails if a merge-base leaf title from the anchored monolith is absent from the union of owned destination `write-loop*.test.ts` files; it passes on an unchanged monolith and fails against the pre-fix tree where the file is absent.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

- None.

## Prerequisites

- `write-loop-test-support` complete: shared helpers and `describe("write loop")` hook setup live in `write-loop.test-support.ts`.
