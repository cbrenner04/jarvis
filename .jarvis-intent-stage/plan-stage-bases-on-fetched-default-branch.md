---
name: plan-stage-bases-on-fetched-default-branch
---

# Pipeline plan stage bases on the fetched default branch

Unsplit rationale: chained plan dispatch and resume re-dispatch share one `resolvePlanStage` path; `resolvePipelineImplementBase` and plan preset `baseRef` input already exist — only pipeline stage resolution must thread them.

## Primary implementation surface

- `v2/src/daemon/pipeline-stage-resolve.ts` (`resolvePlanStage`)

## Problem

Chained pipeline plan stages and `pipeline resume` re-dispatch of a failed plan lane materialize worktrees from the operator checkout's local default branch with no upstream freshness check, so a prerequisite merged on origin but not pulled locally yields stale plan bases and `agent_blocked` on missing prerequisite content.

## Decisions

- Chained plan stage resolution resolves `baseRef` with the same rule as chained implement (`resolvePipelineImplementBase`): fetched upstream when the local default branch is strictly behind; operator checkout untouched; ahead, diverged, untracked, or unfetchable bases keep existing policy.
- Standalone `plan --base` keeps its `base_behind_origin` refusal.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` drives chained plan stage resolution with local default branch strictly behind `origin` and asserts the plan write-step worktree `baseRef` is the fetched upstream tip and matches the remote head without mutating the operator checkout; fails against current code (reachable on main: `chained plan stage resolves write-step baseRef to repository default branch, not prior branch` expects `main` while `chained implement uses fetched upstream without changing the operator checkout` already pins implement upstream behavior).
- [ ] `pipeline-stage-resolve.test.ts` or `pipeline-execution.test.ts` drives `pipeline resume` re-dispatch of a failed plan lane through the same stage-resolution path with local default strictly behind origin and asserts the rematerialized plan write-step uses the fetched upstream `baseRef`; fails against current code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline start — base freshness covers chained plan and implement.
- `v2/docs/pipeline-execution.md` — same chained plan/implement upstream rule.
- `v2/docs/v1-behaviors.md` — extend the pipeline base-freshness entry to plan.

## Prerequisites
