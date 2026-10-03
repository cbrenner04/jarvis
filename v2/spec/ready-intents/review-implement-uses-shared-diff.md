---
name: review-implement-uses-shared-diff
---

# Review-implement delegates branch diff to shared boundary

## Problem

`shared/prompts/review-implement.ts` contains a `branchDiff` function that constructs Git merge-base and diff commands inline: `git merge-base`, `git diff --stat`, `git diff --name-only`, `git diff` (full unified). This duplicates logic being centralized in `shared/git.ts` and misses shared error semantics. Review-implement should call the shared diff boundary instead.

## Decisions

- Review-implement stops constructing Git commands for diffs; it calls typed `shared/git.ts` diff operations instead.
- The shared diff operation returns structured output suitable for review context (stat summary + changed paths + unified diff).
- Error cases (merge-base resolution failure, diff computation failure) are handled consistently across all callers via the shared boundary.
- Plan must decide: whether diff generation for review uses the same stat+unified structure as cleanup uses, whether diff formatting is deterministic (reproducible across runs).

## Prerequisites

- `shared/git.ts` offers consolidated Git operation boundary with diff operations (delivered by: shared-git-operations-boundary)

## Acceptance criteria

- [ ] `shared/prompts/review-implement.ts` no longer constructs Git commands for diffs; `branchDiff` calls `shared/git.ts` diff operation.
- [ ] `review-implement.test.ts`: branchDiff produces the same diff content (stat, changed paths, unified) as before; test injects mock runner to verify delegation.
- [ ] Same file: branchDiff handles merge-base resolution failure gracefully, consistent with `shared/git.ts` operation semantics.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- None — internal refactor; no behavioral change to review prompts.

## Primary implementation surface

- `shared/prompts/review-implement.ts` (delegate branchDiff to shared)
- `shared/prompts/review-implement.test.ts` (verify delegation)
