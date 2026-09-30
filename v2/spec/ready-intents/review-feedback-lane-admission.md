---
name: review-feedback-lane-admission
---

# Admit only completed plan or implement lanes with an open PR

## Problem

There is no admission path that binds a review-feedback run to the branch, worktree, and PR a finished plan or implement lane already published.

## Behavior

`jarvis run workflow <review-feedback-preset> --branch <lane-branch>` (exact preset name chosen at plan time) admits only a **completed** plan or implement lane — bare workflow run or pipeline stage. The operator names the lane by its published branch; when the lane came from a pipeline stage, required disambiguators are `--pipeline <id>`, `--stage <stage-id>`, and `--branch-key <key>` when fan-out requires it. Admission resolves that lane's branch, worktree, and still-open PR, runs the capture prelude (refreshing the durable review artifact via `gh`), then admits write-step dispatch. It refuses with a named reason when the lane is in flight, the PR is merged or closed, the target is not plan/implement, lane targeting is ambiguous or unmatched, or capture fails. Standalone launch only; pipeline stage dispatch for this preset remains forbidden by validation.

## Acceptance criteria

- [ ] Regression tests fail against missing admission and prove successful resolution for a completed bare implement run and for a completed pipeline implement stage targeted with the declared CLI flags and an open PR, plus named refusals for in-flight lanes, merged or closed PRs, wrong workflow kinds, and capture-prelude failure.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — how to target a completed lane and expected refusal reasons.

## Prerequisites

- The preset registry records whether each registered CLI workflow may be used as a pipeline stage `workflow` value, and pipeline definition validation rejects stage workflows marked standalone-only with a named error.
- A capture step writes or refreshes a lane-scoped durable review artifact from the open PR via `gh` (invoked automatically during review-feedback admission).
