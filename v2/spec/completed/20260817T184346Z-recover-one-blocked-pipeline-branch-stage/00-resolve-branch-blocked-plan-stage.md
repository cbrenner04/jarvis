# 00 - Resolve a branch blocked plan stage into a recovery request

## Problem

`recoverPlanStage` (`v2/src/execution/workflow-runner.ts`) has no production caller: nothing maps a pipeline `(pipelineId, branchKey)` to the branch's failed plan stage, its linked entry run, and the review actuator step that carries the plan-tree landing. Pipeline resume can only reopen that row for fresh dispatch, which redrafts.

## Decision ledger

- The recovery target is `(pipelineId, branchKey)` resolved against durable stage rows, with `branchKey: "default"` addressing unscoped rows; rules out branch-scoped resume's `branch_not_found`-on-no-fan-out-split rule, which would make a single-branch pipeline's blocked plan stage permanently unrecoverable. Exercised by its own resolution-AC case, not just claimed.
- Admission selects the branch's single `failed` workflow stage row and reads its retained `workflowInvocationId` as the entry run; rules out accepting an operator-supplied run ID that is not that row's own linkage.
- Resolution refuses `missing_context` when the pipeline's durable `context` is null, before re-resolving steps — the same reason `continuePipeline`/`resumePipeline` already return for a context-less pipeline (`pipeline-execution.ts`), and the same precondition `resolveStage`'s non-nullable `context` parameter requires; rules out inventing a synonym refusal for a case resume already names.
- The steps recovery runs come from re-resolving the stage through the same `resolveStage` dep ordinary dispatch uses, minus the leading write step; rules out reconstructing them from `run.workflowSnapshot.steps`, whose `WorkflowSnapshotStep` shape carries no worktree, landing, or bindings.
- The recovered review step's `landing.durablePath` is overridden to the linked entry run's recorded `specPath`; `buildPlanWorkflowSteps` stamps a fresh UTC timestamp into the durable spec dir on every resolution, so a re-resolved path would land the corrected tree in a directory no stage artifact ever names.
- Resolution refuses a stage whose re-resolved steps carry no `review`/`review-debate` step with a `plan-tree` landing; a `review: "none"` plan stage (the `fast` registry pipeline) lands on its write step, which recovery never re-runs.
- Resolution refuses when the re-resolved review step's `cwd` differs from the linked run's `worktreePath`; recovery revalidates `<worktreePath>/.jarvis-plan-stage` while the actuator edits `cwd`, so divergence would validate one tree and land another.
- Named refusals: `pipeline_not_found`, `branch_not_found`, `missing_context`, `no_failed_stage`, `stage_not_plan`, `stage_not_linked`, `stage_resolution_failed`, `stage_not_recoverable`; rules out `pipeline_not_resumable`, which cannot tell an operator which branch refused or why.
- Run-shaped admission (populated staging, `blocked` status with a `contract_miss`/`blocked` outcome, Git mode, operator-authored blocker, staged contract validity) stays inside `recoverPlanStage`; rules out duplicating that contract at the pipeline layer where it would drift.

## Task checklist

- Add `v2/src/daemon/pipeline-stage-recovery.ts` exporting a resolution entry point that takes `{ pipelineId, branchKey }` plus the pipeline execution deps and returns either a `PlanStageRecoveryRequest`-shaped admitted target (runId, project, branch, worktreePath, writeStepId, steps) or a named refusal.
- Resolve the branch's failed row, its authored stage (`workflow: "plan"`), and its linked entry run; refuse `missing_context` when the pipeline's `context` is null; otherwise re-resolve the stage's steps through `deps.resolveStage` with the branch's durable artifacts, drop the leading write step, and pin the review step's `landing.durablePath` to the entry run's `specPath`.
- Export `findStageRecord` and `buildBranchStageArtifacts` from `pipeline-execution.ts` for reuse rather than adding parallel walkers.
- Add `v2/src/daemon/pipeline-stage-recovery.test.ts` covering the admitted resolution and every refusal, split across two refusal tests (see acceptance criteria) so a fixture that trips an earlier guard cannot leave a later guard's own mutation green.
- Add in-body `// @mutate` directives on stable, unique production lines for the keystone and every added selection and refusal guard.
- Document the resolution and refusal contract in `v2/docs/daemon-host.md`.

## Acceptance criteria

- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` test `resolves a branch blocked plan stage into a recovery request pinned to the linked run` fails against the pre-fix code, then proves a fan-out pipeline whose named branch's `plan` stage is `failed` resolves to a request naming that row's linked entry run, its project, branch, worktree path, and write step id, carrying only the re-resolved review step, whose `landing.durablePath` equals the entry run's recorded `specPath` and not the freshly resolved timestamped path; a second, single-branch pipeline whose failed plan stage is recorded under `branchKey: "default"` resolves the same way, naming that row's own linked entry run.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` test `refuses an unresolvable pipeline or branch recovery target with a named reason` proves, each against a fixture minimal enough that only its own guard can fire: an unknown pipeline id (`pipeline_not_found`), an unknown or empty branch key on a real pipeline (`branch_not_found`), and an otherwise-resolvable failed branch whose pipeline `context` is null (`missing_context`) — each producing no request.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` test `refuses an unrecoverable stage target with a named reason` proves, each against a fixture minimal enough that only its own guard can fire: a branch with no failed row (`no_failed_stage`), a failed non-plan workflow stage (`stage_not_plan`), a failed plan row with no `workflowInvocationId` or a missing run row (`stage_not_linked`), a `resolveStage` error (`stage_resolution_failed`), a `review: "none"` plan stage (`stage_not_recoverable`), and a resolved review step whose `cwd` differs from the linked run's `worktreePath` (`stage_not_recoverable`) — each producing no request.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` — `resolves a branch blocked plan stage into a recovery request pinned to the linked run`; Keystone checkpoint: an in-body `// @mutate` directive rebinding the resolved recovery steps and landing to the raw re-resolved stage steps restores redraft-shaped output and turns this test red.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` — `refuses an unresolvable pipeline or branch recovery target with a named reason`; Mutation checkpoint: in-body directives invert the added pipeline-lookup, branch-lookup, and `missing_context` guards on their real production lines; each mutation turns this test red, and the assertions prove the otherwise-suppressed request is absent.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` — `refuses an unrecoverable stage target with a named reason`; Mutation checkpoint: in-body directives invert every added failed-row, plan-stage, linked-run, resolution-error, plan-tree-review-landing, and `cwd`-match refusal guard on its real production line; each mutation turns this test red, and the assertions prove the otherwise-suppressed request is absent.
- [x] `v2/src/daemon/pipeline-execution.test.ts` stays green (exporting `findStageRecord` and `buildBranchStageArtifacts` changes no behavior).
- [x] `v2/docs/daemon-host.md` documents branch-scoped blocked-stage recovery target resolution: `(pipelineId, branchKey)` against durable rows with `default` addressing unscoped rows and no fan-out requirement, re-resolution of the stage's steps minus the write step, the `durablePath` pin to the linked run's `specPath` and why, and the full refusal vocabulary including `missing_context`.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — new section for branch-scoped blocked-stage recovery covering target resolution, step re-resolution, the durable-path pin, and the named refusals.

## Implementer notes

- `PlanStageRecoveryRequest` (`v2/src/execution/workflow-runner.ts`) is the request shape to build; keep its run-shaped admission where it is.
- `buildBranchStageArtifacts(pipeline, split, branchKey, index)` is the same artifact reconstruction `runAuthoredStages` uses for a branch walk; reuse it so re-resolution sees the intent stage's `downstreamInputs`.
- The `full-review` registry pipeline (`v2/src/execution/pipeline-registry.ts`) is the fixture shape to model: `intent` → `approve-intent` → `plan` (`review: "debate"`) → `approve-plan` → `implement`.
- Keep the resolution effect-free: no store writes, no claims, no dispatch. Settlement and execution land in `01`.
- The keystone mutation only goes red if the injected `resolveStage` stub returns a `landing.durablePath` that differs from the entry run's recorded `specPath` (e.g. a stub-stamped fresh timestamp path) — a stub that happens to return the same path as `specPath` makes the pin inert and the mutation a no-op; build the fixture so the two paths provably differ.
