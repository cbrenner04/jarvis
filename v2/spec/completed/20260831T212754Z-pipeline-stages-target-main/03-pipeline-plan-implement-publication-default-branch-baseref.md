# Pipeline plan and implement publication default-branch baseRef

## Problem

Even after implement resolution and preflight decoupling, operators need an end-to-end guard that plan and implement completion publication both capture repository default branch as publication `baseRef`, not `prior.branch`. Pre-fix implement resolution stacks implement publication on the plan stage branch.

## Surface

Primary: `v2/src/daemon/pipeline-execution.test.ts`. In-scope: `runPipeline` / stage settlement wiring only as needed to reach mocked completion publication.

## Prerequisites

- Subspec 00 landed: chained implement resolved `baseRef` is repository default branch.
- Subspec 01 landed: chained implement preflight spec-availability decoupled from publication `baseRef`.

## Decisions

- Test drives intent → plan → implement (or plan → implement) through `runPipeline` with real `WORKFLOW_PRESET_BUILDERS` and mocked `completionPublisher` — rules out `resolveStageWithFixedImplementSteps` and rules out stub `implementSteps(planBranch)` builder output for this regression.
- Capture `baseRef` from completion publication input per stage — rules out asserting only resolved write-step fields without publication boundary.
- Plan publication `baseRef` should already be default branch pre-fix (weak reachability for plan leg); implement publication `baseRef` is the failing leg — rules out a test that passes on baseline by skipping implement publication.
- E2e fixtures materialize implement worktrees from repository default branch, not `prior.branch` — rules out `materializeWorktree(implementBranch, planBranch)` parent pinning that masks stacked publication.
- No migration for in-flight pipelines started under stacked `baseRef`; `completion-publisher.ts` retarget logic stays for legacy stacked bases — rules out deleting publication-time retarget or operator guidance for already-running stacked runs.
- Merge-first retarget operator workarounds for vanished stacked bases retire for new runs in docs, not in retarget code — rules out deleting publication-time retarget in this spec.

## Task checklist

- Add regression `chained pipeline plan and implement publication target repository default branch` in `pipeline-execution.test.ts`: git fixture with distinct stage branches, real `WORKFLOW_PRESET_BUILDERS`, mocked workflow completion, mocked `completionPublisher` recording `baseRef` per stage; do not use `resolveStageWithFixedImplementSteps`.
- Cut implement worktree fixtures from repository default branch (`materializeWorktree(implementBranch, defaultBranch)` or equivalent), not plan stage branch.
- Assert plan and implement captured publication `baseRef` each equal repository default branch, neither `prior.branch`.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` — `chained pipeline plan and implement publication target repository default branch` drives `runPipeline` with real `WORKFLOW_PRESET_BUILDERS` through plan and implement completion publication and asserts each stage's captured publication `baseRef` is the repository default branch, not `prior.branch`; fails when implement publication stacks on the plan branch (reachable on main: chained implement resolution pins `baseRef: prior.branch` in `resolveImplementStage` and baseline e2e fixtures parent implement worktrees on `planBranch`; must not use `resolveStageWithFixedImplementSteps`).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — chained plan/implement stages target repository default branch; two-ref model (default-branch publication/worktree vs `prior.branch` preflight availability); retire stacked-PR base chaining for new runs; distinguish legacy in-flight retarget from new-run main targeting.
- `v2/docs/operator-runbook.md` — surgically retire stacked-PR merge-first-hazard and stacked-stage landing guidance superseded by main targeting; preserve or relocate plan-stage `git mv` / admission-pinned-main gotcha from landing guidance.
- `v2/docs/v1-behaviors.md` — pipeline stage PR base targeting for plan and implement stages.
