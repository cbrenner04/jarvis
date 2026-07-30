# Preset-builder chained handoff

## Problem

Even when resolution threads the prior entry-run `worktreePath` as preset `cwd`, real plan/implement preset builders still fail: `findProjectMatch(input.cwd, registry)` only matches paths under the registered project root, and implement preflight runs `isSpecAvailableInBaseRef` against the project root and `baseRef` (default branch), so a plan spec that exists only on an unmerged plan worktree fails.

## Surface

Primary: `v2/src/execution/publication-workflow-steps.ts` (plan project match + `readReadyIntent`), `v2/src/execution/implement-workflow-steps.ts` (implement preflight). In-scope support: `shared/project-registry.ts` if worktree path matching is centralized; pipeline resolution deps that thread builder overrides into `resolveStageWorkflowSteps`. Depends on subspec 00.

## Prerequisites

- Subspec 00 landed: chained resolution sets preset `cwd` to prior entry-run `worktreePath` and threads full `PipelineStageArtifact` objects.

## Decisions

- Pipeline chained plan/implement builders resolve the admission project via a pipeline-scoped `resolveProjectMatch` that maps `cwd` under the registered project root **or** jarvis external worktrees for that project to `{ key, root: PipelineContext.cwd }` — rules out requiring merged artifacts on `main` for project lookup.
- Chained implement `baseRef` is the prior (plan) entry run `branch`; `isSpecAvailableInBaseRef` runs with git root `priorEntryRun.worktreePath` and worktree-relative `specPath` — rules out checking plan spec availability on `PipelineContext.cwd` / default branch when the artifact is already on the plan worktree.
- Pipeline chained implement does not skip `isSpecAvailableInBaseRef`; it relocates the check to the plan worktree — rules out silently bypassing preflight when `projectRoot` is injected.
- Standalone CLI implement (`jarvis run workflow implement`) keeps existing project-root + default-branch preflight — rules out changing non-pipeline callers.
- Unit tests use repo-nested `.jarvis-worktrees/` under the registered project root as the worktree layout surrogate; production `~/.jarvis/worktrees/...` layout proof is deferred — rules out blocking this subspec on home-dir worktree fixtures.

## Task checklist

- Thread pipeline-scoped `resolveProjectMatch` (or equivalent builder deps) from `resolveStageWorkflowSteps` into plan and implement preset builders for chained stages.
- Implement chained `resolveBaseRef` / preflight contract: `baseRef` = prior entry run `branch`; `isSpecAvailableInBaseRef(priorEntryRun.worktreePath, baseRef, artifact.specPath)`.
- Add `plan-workflow-steps.test.ts` / `implement-workflow-steps.test.ts` (or `pipeline-stage-resolve.test.ts` with `WORKFLOW_PRESET_BUILDERS`) regressions: chained inputs succeed when artifacts exist only on prior worktrees and are absent from operator `context.cwd` and from `main`.
- Add guard-inversion or equivalent negative coverage for the new project-match / preflight guards.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` (or `plan-workflow-steps.test.ts`) — resolving the plan stage through `WORKFLOW_PRESET_BUILDERS` succeeds when the ready-intent file exists only on the intent entry-run worktree; resolution fails when the worktree-root guard is inverted via `setInvertPriorWorktreeRootGuardForTest(true)`.
- [ ] `pipeline-stage-resolve.test.ts` (or `implement-workflow-steps.test.ts`) — resolving the implement stage through `WORKFLOW_PRESET_BUILDERS` succeeds when the plan spec tree exists only on the plan entry-run worktree branch and is absent from `main`; resolution fails when `setInvertPriorWorktreeRootGuardForTest(true)`.
- [ ] `implement-workflow-steps.test.ts` — chained pipeline preflight uses prior entry-run `worktreePath` as git root and prior entry-run `branch` as `baseRef` (not operator checkout / default branch).
- [ ] `bun run test:v2` exits zero.

## Documentation updates

None — operator semantics landed in subspec 00.
