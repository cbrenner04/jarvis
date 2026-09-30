---
name: plan-stage-bases-on-fetched-default-branch
---

# Pipeline plan stage bases on the fetched default branch

## Problem

A chained pipeline plan stage (and `pipeline resume` re-dispatch of a failed plan lane) branches from the operator checkout's local default branch. When the operator merged a prerequisite PR on GitHub but has not pulled, the plan branches from stale `main` and settles `agent_blocked` on a missing prerequisite. The runbook (§ Pipeline start) and `pipeline-execution.md` promise fetch-and-use-upstream only for chained implement: `resolveImplementStage` (`v2/src/daemon/pipeline-stage-resolve.ts`) calls `resolvePipelineImplementBase` (`v2/src/execution/implement-workflow-steps.ts`, `checkBaseFreshness` → upstream when local is strictly behind). `resolvePlanStage` passes no `baseRef`, so the plan builder (`v2/src/execution/publication-workflow-steps.ts`) falls back to `getBaseBranch(project.root)` — the bare local branch name, no freshness check. Resume re-dispatch goes through the same `resolveStageWorkflowSteps` path.

## Evidence

- 2026-09-30 review-roles plan lane (pipeline `ebb385e7`): runs `0c9e2173`, `b21b2d14` blocked naming #4266 content absent.
- 2026-09-30 settle lane (pipeline `290a22ee`): run `05f5204b` blocked naming #4268 content absent.
- Both prerequisites were merged on origin minutes earlier; the local checkout was behind.

## Decisions

- Plan-stage dispatch and re-dispatch resolve `baseRef` with the same rule as chained implement (`resolvePipelineImplementBase`): fetched upstream when the local default branch is strictly behind; operator checkout untouched; ahead/diverged/untracked/unfetchable keep existing policy.
- Standalone `plan --base` keeps its `base_behind_origin` refusal.

## Acceptance criteria

- [ ] A test proves a chained plan stage with local default branch strictly behind origin materializes its worktree from the fetched upstream tip (fails against current code).
- [ ] A test proves `pipeline resume` re-dispatch of a failed plan lane applies the same rule.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline start and `v2/docs/pipeline-execution.md` — base freshness covers chained plan and implement.
- `v2/docs/v1-behaviors.md` — extend the pipeline base freshness entry to plan.
