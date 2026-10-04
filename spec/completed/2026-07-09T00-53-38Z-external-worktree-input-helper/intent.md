---
name: external-worktree-input-helper
---

# Extract repeated input object in external-worktree.test.ts into a helper

`external-worktree.test.ts` repeats the same 7-line input object across
tests.

## Decisions

- Extract the repeated 7-line input object into a `makeInput()` helper.

## Out of scope

- Src changes.
- Any behavior change beyond the extraction.

## Verification

Test-count diff vs baseline in the PR body (test count unchanged; only setup
is deduplicated).

## Prerequisites
