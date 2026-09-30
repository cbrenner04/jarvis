---
name: review-feedback-lane-admission
---

# Admit only completed plan or implement lanes with an open PR

## Problem

There is no admission path that binds a review-feedback run to the branch, worktree, and PR a finished plan or implement lane already published.

## Behavior

`jarvis run workflow <review-feedback-preset>` (exact preset name chosen at plan time) admits only a **completed** plan or implement lane — bare workflow run or pipeline stage — resolves its branch, worktree, and still-open PR, and refuses with a named reason when the lane is in flight, the PR is merged or closed, the target is not plan/implement, or review input was not captured. Standalone launch only; pipeline stage dispatch for this preset remains forbidden by validation.

## Acceptance criteria

- [ ] Regression tests fail against missing admission and prove successful resolution for a completed bare implement run and for a completed pipeline implement stage with an open PR, plus named refusals for in-flight lanes, merged or closed PRs, and wrong workflow kinds.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — how to target a completed lane and expected refusal reasons.

## Prerequisites

- The preset registry records whether each registered CLI workflow may be used as a pipeline stage `workflow` value, and pipeline definition validation rejects stage workflows marked standalone-only with a named error.
- PR review threads and comments for a lane's open PR are captured into one durable review artifact via `gh`, with the PR as the sole feedback source.
