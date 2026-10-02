# Plan `landing.inputs` consume from the ready-intent read root

## Problem

Git-chained plan resolves and validates the ready-intent on the prior intent entry-run worktree (`pipeline-stage-resolve` binds `cwd` to `readRoot`), but `resolvePlanReadyIntentInput` still records `landing.inputs` with `sourceRoot: project.root` and `paths: [resolve(project.root, relative)]` plus `consumeFrom: "worktree"`. `consumePublicationInputs` then requires the file under both `project.root` and the plan worktree at that relative path. With the intent PR unmerged the ready-intent exists only on the intent worktree, so both containment checks fail and consumption silently no-ops (`shared/publication-input-consumption.ts` returns `[]`); the queue file survives on `main` after the intent PR merges. External-home and rematerialized-on-plan-worktree paths are fixed; in-repo detached handoff is not.

## Surface

Primary: `v2/src/execution/publication-workflow-steps.ts` (`resolvePlanReadyIntentInput` / `planSource` `landing.inputs`). Shared landing: `v2/src/execution/publication-landing.ts` (`landPlanTree`, unchanged). Verification: `v2/src/daemon/pipeline-execution.test.ts`, `v2/src/execution/workflow-runner-core.test.ts`. Docs: `v2/docs/first-workflow-walkthrough.md`, `v2/docs/v1-behaviors.md`.

## Decisions

- **Source recording** (`landingSourceRoot` = validation root, absolute `landingInputPath`, `landing.inputs.consumeFrom: "source"` including repo/git mode) only when `validateReadyIntent` succeeded on `join(input.cwd, relative)` and no project-checkout copy exists at `resolve(project.root, relative)` at resolution time — rules out branching on `input.cwd !== project.root` alone (that would flip to source while `main` still has the queue file, breaking `pipeline-execution.test.ts` `"pipeline plan stage landing deletes consumed ready-intent from plan worktree"` even though resolution reads the intent worktree).
- **Worktree recording** (`sourceRoot: project.root`, `paths: [resolve(project.root, relative)]`, `consumeFrom: "worktree"`) when a project-checkout copy exists at `resolve(project.root, relative)` at resolution time, including git-chained plan that validated on the prior intent worktree while `main` already holds the same relative path — rules out source recording whenever `cwd` is a prior-stage read root.
- When the ready-intent is already present on the plan worktree at the project-relative path (chained rematerialization from `main`), worktree recording still applies so the plan PR removes the plan-branch copy — rules out regressing `pipeline-execution.test.ts` `"pipeline plan stage landing deletes consumed ready-intent from plan worktree"`.
- Standalone `run workflow plan` from the project checkout with the ready-intent on the plan worktree keeps worktree-targeted deletion — rules out breaking `workflow-runner-core.test.ts` `"lands the byte-identical ready intent before consuming plan inputs"`.
- `landPlanTree` / `consumePublicationInputs` stay shared; no pipeline-only landing fork — rules out reimplementing consumption in `publication-landing.ts` or `pipeline-stage-resolve.ts`.
- Cleanup `provenIntentPrune` slug lookup stays out of scope — rules out coupling this slice to `cleanup-prunes-consumed-ready-intent-by-slug`.

## Tasks

- [ ] Branch on project-checkout presence at `resolve(project.root, input.readyIntent)` (see Decisions) in `resolvePlanReadyIntentInput` and `planSource` `landing.inputs`: when absent, source recording with `consumeFrom: "source"` even in repo/git mode; when present, worktree recording with `consumeFrom: "worktree"` and today's `project.root` + project-relative path.
- [ ] Add `pipeline-execution.test.ts` detached-handoff case in setup that does not inherit the shared describe `beforeEach` commit of the ready-intent onto `repoRoot` (`main`) — nested `describe`, alternate `beforeEach`, or explicit remove/revert on `main` after intent-worktree commit — so the file exists only on the intent worktree before landing; then resolve the `full-review` plan stage through production builders with `loadRun` returning the intent worktree, land via `landReviewedPublicationOutput`, and assert the ready-intent is deleted from the intent worktree path that held it.
- [ ] Update `v2/docs/first-workflow-walkthrough.md` inter-stage handoff prose and `v2/docs/v1-behaviors.md` pipeline/standalone plan consumption bullets per Documentation updates below.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — detached-handoff case: fixture keeps the ready-intent off `main` and off the plan worktree before landing (not the shared `beforeEach` that commits onto `repoRoot`); production plan-stage resolution, `landReviewedPublicationOutput` landing, and assertion that the ready-intent is absent from its intent-worktree source path; fails against the pre-fix silent no-op reachable when `landing.inputs` still target `project.root` under `consumeFrom: "worktree"` while the file exists only on the intent worktree.
- [ ] `workflow-runner-core.test.ts` test `"lands the byte-identical ready intent before consuming plan inputs"` stays green.
- [ ] `pipeline-execution.test.ts` test `"pipeline plan stage landing deletes consumed ready-intent from plan worktree"` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — inter-stage handoff and plan consumption: merging intent/plan PRs between stages is not required; the plan stage deletes the chained ready-intent from the source it read (intent worktree, external home, or plan worktree copy), not only from the plan branch diff when a `main` copy never existed.
- `v2/docs/v1-behaviors.md` — record git-chained plan `landing.inputs` source resolution (read root vs project root) alongside existing standalone and external-home consumption bullets.
