# Chained plan stage pipeline base freshness

## Problem

Chained pipeline plan stages and `pipeline resume` re-dispatch of a failed plan lane materialize worktrees from the operator checkout's local default branch with no upstream freshness check. A prerequisite merged on origin but not pulled locally yields stale plan bases and `agent_blocked` on missing prerequisite content. Chained implement already calls `resolvePipelineImplementBase` in `resolveImplementStage`; `resolvePlanStage` omits `PlanWorkflowInput.baseRef`, so `buildPlanWorkflowSteps` falls back to bare `getBaseBranch(project.root)`.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts` (`resolvePlanStage`). In-scope: `pipeline-stage-resolve.test.ts`, `pipeline-execution.test.ts` (failed-plan resume rematerialization), `v2/docs/operator-runbook.md`, `v2/docs/pipeline-execution.md`, `v2/docs/v1-behaviors.md`. Reuse `resolvePipelineImplementBase` and `checkBaseFreshness` from `implement-workflow-steps.ts`; do not change standalone CLI plan admission or `publication-workflow-steps.ts` defaulting when `baseRef` is omitted outside pipeline resolution.

## Decisions

- Chained plan resolution sets preset `baseRef` via `resolvePipelineImplementBase` on `PlanWorkflowInput` — rules out teaching `buildPlanWorkflowSteps` to fetch upstream when `baseRef` is absent (would affect standalone plan) or duplicating freshness logic in `resolvePlanStage`.
- Default branch name for freshness comes from `getBaseBranch(context.cwd)` — rules out `getBaseBranch(project.root)` or `prior.branch` as the local base label passed to `resolvePipelineImplementBase`.
- Freshness `gitRoot` is `prior.cwd` when `isGitRepoAsync(prior.cwd)`, else `context.cwd` — rules out always using admission `context.cwd` (breaks admission rebinding and fan-out read roots) or always using `project.root`.
- Ahead, diverged, untracked, and unfetchable bases keep `resolvePipelineImplementBase` / `checkBaseFreshness` behavior unchanged — rules out new pipeline-only freshness branches.
- Standalone `jarvis run workflow plan --base` keeps `base_behind_origin` refusal on the CLI path — rules out routing standalone plan through `resolvePipelineImplementBase`.

## Task checklist

- In `resolvePlanStage`, wire preset `baseRef` per this subspec's Decisions (`defaultBase` from `getBaseBranch(context.cwd)`, `baseRoot` = `prior.cwd` when `isGitRepoAsync(prior.cwd)` else `context.cwd`, `baseRef` from `resolvePipelineImplementBase(baseRoot, defaultBase)` on `PlanWorkflowInput`) — not implement's `readRoot` from `resolveChainedImplementSpecPath`.
- Update `chained plan stage resolves write-step baseRef to repository default branch, not prior branch` in `pipeline-stage-resolve.test.ts`: reuse the behind-`origin` fixture from `chained implement uses fetched upstream without changing the operator checkout` (bare remote, publisher advances `main`, operator `main` strictly behind, checkout untouched); assert plan write-step `baseRef` is `origin/main` (or resolved upstream ref) whose tip matches remote `HEAD`; keep assertion that `baseRef` is not `prior.branch`.
- Extend `whole-pipeline failed plan resume retires dirty draft and rematerializes from base before writer dispatch` in `pipeline-execution.test.ts` with the same behind-`origin` fixture; assert resolved plan write-step `baseRef` (upstream tip when local default is strictly behind) from stage resolution output — e.g. resume-test-local `resolveStage` plan builder that forwards `PlanWorkflowInput.baseRef`, or real `WORKFLOW_PRESET_BUILDERS.plan` — not dispatch worktree `HEAD` compared to local `intentBranch` at `projectRoot`. Resume-test-local forwarding of `input.baseRef` suffices; do not rewrite shared `fixedPlanStepResolver` unless a preservation AC cites `pipeline workflow-stage stale-reset preflight`.
- Align `v2/docs/operator-runbook.md` § Pipeline start, `v2/docs/pipeline-execution.md` resolution paragraph, `v2/docs/v1-behaviors.md` **[v2 behavior change] Pipeline base freshness** (~819), and the pipeline inter-stage handoff catalog entry (~301) so chained plan `baseRef` matches chained implement upstream-when-behind; standalone stale-base refusal unchanged.

## Acceptance criteria

- [x] `pipeline-stage-resolve.test.ts` — `chained plan stage resolves write-step baseRef to repository default branch, not prior branch` uses the behind-`origin` fixture shared with `chained implement uses fetched upstream without changing the operator checkout`, asserts plan write-step `baseRef` is the fetched upstream tip matching remote `HEAD`, and still rules out `prior.branch`; fails against current code (reachable on main: that test expects local `main` today on `createChainedHandoffRepo()` without advancing origin).
- [x] `pipeline-execution.test.ts` — `whole-pipeline failed plan resume retires dirty draft and rematerializes from base before writer dispatch` adds the same behind-`origin` fixture and asserts resolved plan write-step `baseRef` is the fetched upstream tip matching remote `HEAD`, observed from `resolvePlanStage` / `resolveStageWorkflowSteps` output (preset input or write-step `baseRef` via resume-test-local plan builder or real plan preset builder) — not dispatch `HEAD` vs local default at `projectRoot`; fails against current code (reachable on main: `fixedPlanStepResolver` ignores preset `baseRef` and the test pins rematerialized `HEAD` to `intentBranch` at `projectRoot`).
- [x] `pipeline-stage-resolve.test.ts` — `chained implement uses fetched upstream without changing the operator checkout` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline start — chained plan and implement both fetch default-branch upstream when local default is strictly behind; operator checkout unchanged; standalone `plan` / `implement --base` refusal unchanged.
- `v2/docs/pipeline-execution.md` — chained plan and implement share the upstream `baseRef` rule; update the resolution paragraph that today describes implement-only fetch.
- `v2/docs/v1-behaviors.md` — extend **[v2 behavior change] Pipeline base freshness** (~819) and reconcile pipeline inter-stage handoff (~301) so chained plan `baseRef` uses upstream-when-behind like implement, not bare `getBaseBranch(context.cwd)` only.
