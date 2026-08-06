# Pipeline plan landing consumes chained ready-intent

## Problem

Standalone `run workflow plan` deletes the ready-intent it planned from in its own PR. The `full-review` pipeline plan stage branches from `main`, rematerializes the ready-intent from the prior stage artifact, and lands only the spec tree — leaving the ready-intent orphaned on `main` after both PRs merge. `landPlanTree` already consumes `landing.inputs` when set; chained pipeline plan passes `cwd` from the prior entry-run worktree while `planSource` builds `landing.inputs.paths` from `join(cwd, readyIntent)`, so the delete target misses the project-relative path on the plan worktree where the rematerialized ready-intent lives.

## Surface

Primary: `v2/src/execution/publication-workflow-steps.ts` (`planSource` / `landing.inputs.paths` construction in `buildPlanWorkflowSteps`). Shared landing contract: `v2/src/execution/publication-landing.ts` (`landPlanTree` / `consumePublicationInputs`). In-scope support: `v2/src/execution/workflow-runner.ts` (review-deferred plan landing via `landReviewedPublicationOutput`), `v2/src/daemon/pipeline-stage-resolve.ts` (`resolvePlanStage` / `resolvePlanWorkflowStage`), `v2/src/daemon/pipeline-execution.test.ts`, durable docs.

## Prerequisites

- Git-backed plan workflows land a spec tree via `landPublication` with `kind: "plan-tree"` and optional `inputs` consumption (`publication-landing.ts`, `publication-landing.test.ts`).
- Standalone `run workflow plan` records ready-intent consumption in the write step's `landing.inputs` and deletes the ready-intent from the plan worktree on successful landing (`publication-workflow-steps.ts` `planSource`, `workflow-runner.test.ts` `"lands the byte-identical ready intent before consuming plan inputs"`).
- Pipeline plan stage resolution passes the prior stage's ready-intent `specPath` into the plan preset builder (`resolvePlanStage` / `resolvePlanWorkflowStage` in `pipeline-stage-resolve.ts`, `pipeline-stage-resolve.test.ts`).
- Durable stage artifacts on the intent stage entry run carry the ready-intent path consumed by the plan stage (`pipeline-stage-dispatch.ts`, `pipeline-execution.ts` artifact carry-forward).

## Decisions

- Pipeline plan landing must delete the consumed ready-intent in the plan worktree so the plan PR diff removes `v2/spec/ready-intents/<slug>.md` — rules out leaving consumption to a follow-up intent PR or manual `git rm`.
- Ready-intent identity comes from the plan input artifact / `specPath` already recorded on the stage — rules out changing the artifact-handoff mechanism.
- Fix `landing.inputs.paths` construction in `planSource` so chained `cwd` ≠ `project.root` still targets the project-relative ready-intent on the plan worktree — rules out a new `consumeInputs` call, a pipeline-only landing fork, or reimplementing consumption in `publication-landing.ts`.
- Standalone plan ready-intent consumption stays on the existing `planSource` / `landPlanTree` landing path — rules out diverging shared publication landing.
- Fan-out plan branches bind per-branch ready-intents via `resolveForDownstreamPaths`; the same `planSource` path fix applies per branch on landing.
- Out of scope: changing how intent stages add ready-intents or how stage artifacts are recorded — rules out intent landing or artifact schema edits in this slice.

## Tasks

- [x] Normalize `planSource` `landing.inputs.paths` so chained pipeline plan resolves the consumed ready-intent to its project-relative path on the plan worktree (not `join(priorEntryRunCwd, readyIntent)` when that cwd differs from `project.root`); `landPlanTree` / `consumePublicationInputs` stay unchanged.
- [x] Add `pipeline-execution.test.ts` — `"pipeline plan stage landing deletes consumed ready-intent from plan worktree"`: git fixture with intent-stage artifact carrying a project-relative ready-intent path, plan worktree branched from `main` with the ready-intent present at that path (mirroring chained rematerialization); resolve the plan stage through production `resolvePlanWorkflowStage` / `buildPlanWorkflowSteps` (agent/write loop stubbed); land through `landReviewedPublicationOutput` using the resolved write step's `landing` object and a `full-review`-style reviewed plan preset (matching review-deferred production landing); assert the ready-intent is absent from the plan worktree at its project-relative path and that path appears in `git diff --name-only` on the plan worktree after landing (same deletion-in-publication-commit contract as `workflow-runner.test.ts` `"lands the byte-identical ready intent before consuming plan inputs"`); fails against pre-fix code.
- [x] Add `// @mutate` on that test targeting the `planSource` line that constructs `landing.inputs.paths` for plan workflows (stable unique anchor in `publication-workflow-steps.ts`); applying the mutation breaks chained ready-intent path resolution and turns the regression RED without turning `"lands the byte-identical ready intent before consuming plan inputs"` RED.
- [x] Update `v2/docs/first-workflow-walkthrough.md` § Configured pipeline and `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` — `"pipeline plan stage landing deletes consumed ready-intent from plan worktree"` resolves the plan stage through production `resolvePlanWorkflowStage` / `buildPlanWorkflowSteps`, lands through `landReviewedPublicationOutput` with the resolved write step's `landing` object, and asserts the consumed ready-intent is absent from the plan worktree at its project-relative path with that path in `git diff --name-only` after landing; fails against pre-fix code.
- [x] `workflow-runner.test.ts` test `"lands the byte-identical ready intent before consuming plan inputs"` stays green (standalone plan ready-intent consumption unchanged).
- [x] Mutation checkpoint: the `pipeline plan stage landing deletes consumed ready-intent from plan worktree` test in `pipeline-execution.test.ts` carries a `// @mutate` directive on the `planSource` `landing.inputs.paths` construction line in `publication-workflow-steps.ts`; applying it turns that test RED.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — note the plan stage consumes its ready-intent on landing (no orphan on `main` after the plan PR merges); correct any implication that intermediate queue artifacts persist after the plan PR merges.
- `v2/docs/v1-behaviors.md` — record that pipeline plan landing consumes the chained ready-intent from the plan worktree on the same `plan-tree` landing path as standalone `run workflow plan`.

## Blocker

Artifact contract check failed: Hollow mutation checkpoints (the named mutation left the scoped suite green):
- no @mutate directive linked to this criterion; add // @mutate <path> "<original>" -> "<replacement>" on the named pin
