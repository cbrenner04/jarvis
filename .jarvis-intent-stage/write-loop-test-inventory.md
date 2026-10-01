---
name: write-loop-test-inventory
---

# Write-loop split preserves merge-base leaf test titles

## Problem

Splitting `write-loop.test.ts` by `describe` risks dropping or renaming leaf cases without a durable guard; the seed requires the post-split title union to match the pre-split set.

## Behavior

Add a co-located inventory test (same pattern as `workflow-runner-resume-inventory.test.ts`) that anchors merge-base `v2/src/execution/write-loop.test.ts` leaf titles and asserts missing-only parity across every `write-loop*.test.ts` file co-located with `write-loop.ts` that this split owns (`write-loop.test.ts` and new `write-loop-<area>.test.ts` siblings from the split; exclude unrelated stems such as `write-loop-input` and pre-existing extractions like `write-loop-intent-landing`). Surplus titles in destinations are allowed; missing merge-base titles fail.

## Acceptance criteria

- [ ] A new inventory test fails if a merge-base leaf title from the anchored monolith is absent from the union of destination `write-loop*.test.ts` files and passes on an unchanged monolith.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

- None.

## Prerequisites
