---
name: pipeline-plan-stage-consumes-ready-intent
---

# Pipeline plan stage consumes its ready-intent on landing

Splitting does not apply: the fix is one execution-loop surface (plan landing and ready-intent consumption).

## Problem

Standalone `run workflow plan` deletes the ready-intent it planned from in its own PR. The `full-review` pipeline plan stage branches from `main`, rematerializes the ready-intent from the prior stage artifact, and lands only the spec tree — leaving the ready-intent orphaned on `main` after both PRs merge.

## Decisions

- Pipeline plan landing must delete the consumed ready-intent in the plan worktree so the plan PR diff removes `v2/spec/ready-intents/<slug>.md` — rules out leaving consumption to a follow-up intent PR or manual `git rm`.
- Ready-intent identity comes from the plan input artifact / `specPath` already recorded on the stage — rules out changing the artifact-handoff mechanism.
- Standalone plan ready-intent consumption stays on the existing landing path — rules out a pipeline-only fork that diverges from `planSource` / `landPlanTree`.
- Out of scope: changing how intent stages add ready-intents or how stage artifacts are recorded.

## Acceptance criteria

- [ ] After a full-review pipeline plan stage completes landing, the plan worktree's committed file set no longer includes the consumed ready-intent at its project-relative path; a regression in `pipeline-execution.test.ts` (or an equivalent pipeline plan landing test) asserts the deletion and fails against pre-fix code.
- [ ] `workflow-runner.test.ts` test `"lands the byte-identical ready intent before consuming plan inputs"` stays green (standalone plan ready-intent consumption unchanged).
- [ ] Mutation checkpoint: a `// @mutate` directive removing the pipeline plan ready-intent-deletion step from the landing path turns the pipeline regression RED; pin via a unique-basename test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — note the plan stage consumes its ready-intent (no orphan on `main`), correcting any implication that intermediate queue artifacts persist after the plan PR merges.

## Prerequisites

- Git-backed plan workflows land a spec tree via `landPublication` with `kind: "plan-tree"` and optional `inputs` consumption.
- Standalone `run workflow plan` records ready-intent consumption in the write step's `landing.inputs` and deletes the ready-intent from the plan worktree on successful landing.
- Pipeline plan stage resolution passes the prior stage's ready-intent `specPath` into the plan preset builder (`resolvePlanStage` / `resolvePlanWorkflowStage`).
- Durable stage artifacts on the intent stage entry run carry the ready-intent path consumed by the plan stage.
