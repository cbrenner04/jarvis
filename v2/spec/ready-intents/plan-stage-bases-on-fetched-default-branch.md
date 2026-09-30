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
- Plan freshness `gitRoot` matches implement: `prior.cwd` when it is a git repository (the chained plan `readRoot` bound into `prior.cwd`, including fan-out and admission rebinding), otherwise `context.cwd`.
- Standalone `plan --base` keeps its `base_behind_origin` refusal.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` updates `chained plan stage resolves write-step baseRef to repository default branch, not prior branch` using the same behind-`origin` fixture as `chained implement uses fetched upstream without changing the operator checkout` (bare remote, publisher advances `main`, operator `main` strictly behind, checkout untouched) — not only flipping the assertion to `origin/main` on `createChainedHandoffRepo()` where local default still matches remote — and asserts plan write-step `baseRef` is the fetched upstream tip matching remote head; fails against current code (reachable on main: that test expects `main` today).
- [ ] `pipeline-execution.test.ts` extends `whole-pipeline failed plan resume retires dirty draft and rematerializes from base before writer dispatch` with the same behind-`origin` fixture and asserts rematerialized plan write-step `baseRef` is the fetched upstream tip through `resolvePlanStage`; fails against current code (reachable on main: that test pins rematerialization to local branch head at `projectRoot`, not upstream).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline start — base freshness covers chained plan and implement.
- `v2/docs/pipeline-execution.md` — same chained plan/implement upstream rule.
- `v2/docs/v1-behaviors.md` — extend the pipeline base-freshness entry to plan.

## Prerequisites
