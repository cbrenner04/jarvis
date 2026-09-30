---
name: review-feedback-lane-admission
---

# Admit only completed intent, plan, or implement lanes with an open reviewed PR

## Problem

There is no admission path that binds a review-feedback run to the branch, worktree, and PR a finished intent, plan, or implement lane already published.

## Behavior

`jarvis run workflow <review-feedback-preset> --branch <lane-branch>` (exact preset name chosen at plan time) admits only a **completed** intent, plan, or implement lane — bare workflow run or pipeline stage. The operator names the lane by its published branch; when the lane came from a pipeline stage, required disambiguators are `--pipeline <id>`, `--stage <stage-id>`, and `--branch-key <key>` when fan-out requires it. Admission resolves that lane's branch, worktree, and still-open PR, requires at least one review on it, runs the capture prelude (refreshing the durable review artifact via `gh`), then admits write-step dispatch. It refuses with a named reason when the lane is in flight, the PR has no review, the PR is merged or closed, the target is not intent/plan/implement, lane targeting is ambiguous or unmatched, or capture fails. This is the preset's standalone launch; the preset itself is never a pipeline stage `workflow` value (validation forbids it).

## Acceptance criteria

- [ ] Regression tests fail against missing admission and prove successful resolution for completed bare intent, plan, and implement runs and for a completed pipeline stage targeted with the declared CLI flags, each with an open reviewed PR, plus named refusals for in-flight lanes, open PRs with no review, merged or closed PRs, other workflow kinds, and capture-prelude failure.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — how to target a completed lane and expected refusal reasons.

## Prerequisites

- The preset registry records whether each registered CLI workflow may be used as a pipeline stage `workflow` value, and pipeline definition validation rejects stage workflows marked standalone-only with a named error.
- A capture step writes or refreshes a lane-scoped durable review artifact from the open PR via `gh` (invoked automatically during review-feedback admission).
