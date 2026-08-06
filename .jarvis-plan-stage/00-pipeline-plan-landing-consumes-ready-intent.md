# Pipeline plan landing consumes chained ready-intent

## Problem

Standalone `run workflow plan` deletes the ready-intent it planned from in its own PR. The `full-review` pipeline plan stage branches from `main`, rematerializes the ready-intent from the prior stage artifact, and lands only the spec tree — leaving the ready-intent orphaned on `main` after both PRs merge.

## Surface

Primary: `v2/src/execution/publication-landing.ts` (`landPlanTree` / `consumeInputs`) and the plan write-step landing wired through `planSource` / `buildPlanWorkflowSteps` in `v2/src/execution/publication-workflow-steps.ts`. In-scope support: `v2/src/execution/workflow-runner.ts` (review-deferred plan landing), `v2/src/daemon/pipeline-execution.test.ts`, durable docs.

## Prerequisites

- Git-backed plan workflows land a spec tree via `landPublication` with `kind: "plan-tree"` and optional `inputs` consumption (`publication-landing.ts`, `publication-landing.test.ts`).
- Standalone `run workflow plan` records ready-intent consumption in the write step's `landing.inputs` and deletes the ready-intent from the plan worktree on successful landing (`publication-workflow-steps.ts` `planSource`, `workflow-runner.test.ts` `"lands the byte-identical ready intent before consuming plan inputs"`).
- Pipeline plan stage resolution passes the prior stage's ready-intent `specPath` into the plan preset builder (`resolvePlanStage` / `resolvePlanWorkflowStage` in `pipeline-stage-resolve.ts`, `pipeline-stage-resolve.test.ts`).
- Durable stage artifacts on the intent stage entry run carry the ready-intent path consumed by the plan stage (`pipeline-stage-dispatch.ts`, `pipeline-execution.ts` artifact carry-forward).

## Decisions

- Pipeline plan landing must delete the consumed ready-intent in the plan worktree so the plan PR diff removes `v2/spec/ready-intents/<slug>.md` — rules out leaving consumption to a follow-up intent PR or manual `git rm`.
- Ready-intent identity comes from the plan input artifact / `specPath` already recorded on the stage — rules out changing the artifact-handoff mechanism.
- Standalone plan ready-intent consumption stays on the existing `planSource` / `landPlanTree` landing path — rules out a pipeline-only fork that diverges from shared publication landing.
- Out of scope: changing how intent stages add ready-intents or how stage artifacts are recorded — rules out intent landing or artifact schema edits in this slice.

## Tasks

- [ ] Close the pipeline plan landing gap on the shared `plan-tree` landing path so the consumed ready-intent is removed from the plan worktree at its project-relative path and included in the publication commit (same `landing.inputs` / `consumePublicationInputs` contract standalone plan already uses).
- [ ] Add `pipeline-execution.test.ts` — `"pipeline plan stage landing deletes consumed ready-intent from plan worktree"`: git fixture with intent-stage artifact carrying a worktree-relative ready-intent path, plan worktree branched from `main` with the ready-intent present at that path (mirroring chained rematerialization), drive plan-stage landing through production resolution and landing hooks, assert the plan worktree's committed file set no longer includes the ready-intent at its project-relative path; fails against pre-fix code.
- [ ] Add `// @mutate` on that test targeting the guard that performs pipeline plan ready-intent deletion on landing (stable unique line in `publication-landing.ts` or the shared landing wiring); applying the mutation turns the regression RED.
- [ ] Update `v2/docs/first-workflow-walkthrough.md` § Configured pipeline and `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `"pipeline plan stage landing deletes consumed ready-intent from plan worktree"` asserts the plan worktree's committed file set no longer includes the consumed ready-intent at its project-relative path; fails against pre-fix code.
- [ ] `workflow-runner.test.ts` test `"lands the byte-identical ready intent before consuming plan inputs"` stays green (standalone plan ready-intent consumption unchanged).
- [ ] Mutation checkpoint: the `pipeline plan stage landing deletes consumed ready-intent from plan worktree` test in `pipeline-execution.test.ts` carries a `// @mutate` directive that skips pipeline plan ready-intent deletion on landing; applying it turns that test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — note the plan stage consumes its ready-intent on landing (no orphan on `main` after the plan PR merges); correct any implication that intermediate queue artifacts persist after the plan PR merges.
- `v2/docs/v1-behaviors.md` — record that pipeline plan landing consumes the chained ready-intent from the plan worktree on the same `plan-tree` landing path as standalone `run workflow plan`.
