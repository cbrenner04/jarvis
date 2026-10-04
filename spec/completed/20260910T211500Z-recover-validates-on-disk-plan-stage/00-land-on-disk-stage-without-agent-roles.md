# Recover lands the on-disk staged tree without dispatching an agent role

## Problem

After admission and on-disk validation, `recoverPlanStage` (`v2/src/execution/workflow-runner-resume.ts`) calls `executeWorkflow` with the captured review step. That step runs the ordinary review/landing path: reviewer role, landing actuator, and the staged-markdown-lint reprompt actuator — all of which write into `.jarvis-plan-stage/`. On pipeline `443a6cd9` the actuator regenerated the agent's original draft (both original files back, `index.md` relinked to both), and the stage settled `plan_stage_invalid` naming `00-daemon.md`, a file the operator had deleted before invoking. Recovery's whole contract against `pipeline resume` is that it does not redraft.

The landing primitive recovery needs already exists without any role dispatch: `landReviewedPublicationOutput` (same module), which `landReviewedOutputOrFail` calls once its actuator reprompt loop passes.

## Decisions

- Recovery lands via `landReviewedPublicationOutput` directly, not via `landReviewedOutputOrFail`/`finishReviewedLanding` — those record an attempt and emit `iteration_started` on a run row, which the intent forbids. Rules out "reuse the review landing wrapper for parity".
- Recovery performs no landing-time re-validation beyond the existing pre-landing validation — with no agent between validation and landing, nothing can mutate the stage. Rules out keeping a second revalidation pass "for safety".
- `revalidateStagedPlanBeforeLanding` is deleted from the step types and the landing path: recovery was its only producer, so it becomes dead once recovery stops going through `executeWorkflow`. Rules out leaving an unset flag behind.
- Success still commits through `commitRecoveredPlanLanding` unchanged; a landing failure surfaces as a non-`complete` `WorkflowResult` carrying the landing message, so `recoveryAttemptFailureDetail` keeps settling the stage row from the attempt outcome with no new code path in `v2/src/daemon/pipeline-stage-recovery.ts`.
- Recovery keeps reading the landing/verdict configuration from the caller-supplied review step; only role dispatch is dropped. Rules out reconstructing landing inputs from the persisted snapshot.

## Acceptance criteria

- [x] A regression test in `v2/src/execution/workflow-runner-resume.test.ts` recovers a blocked plan stage whose on-disk tree differs from the agent's draft and asserts the landed durable tree is byte-identical to the on-disk tree; it fails against the pre-fix code.
- [x] A test asserts a recovery attempt records no new run row and appends no `iteration_started` for the blocked run, and that the injected `executeWorkflow` seam is never called.
- [x] A test asserts a `plan_stage_invalid` failure message names a file present in the on-disk staged tree at invocation, never one only the agent's draft contained.
- [x] `revalidateStagedPlanBeforeLanding` no longer appears in `v2/src/execution/workflow-runner.ts`.
- [x] `revalidateStagedPlanBeforeLanding` no longer appears in `v2/src/execution/workflow-runner-debate-landing.ts`.
- [x] The admission and refusal tests in `v2/src/execution/workflow-runner-resume.test.ts` (`missing_plan_context`, `stage_identity_mismatch`, `unrelated_plan_stage`, `recovery_requires_git`, `operator_blocker`) stay green — admission is unchanged by this subspec.
- [x] `v2/src/daemon/pipeline-stage-recovery.test.ts` stays green: the stage still settles `failed` with the attempt's own reason and reopens only on `complete`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- [x] `v2/docs/pipeline-execution.md` — recover validates and lands the on-disk staged tree; it invokes no agent role and neither restores nor redrafts.
- [x] `v2/docs/workflow-runner.md` — `recoverPlanStage` is a validate-then-land path, not an `executeWorkflow` review re-entry.
- [x] `v2/docs/operator-runbook.md` — the hand-correct-then-recover procedure works; delete the "`pipeline recover` discards your correction (2026-09-08)" bullet and the note that `resume` is the only path for a blocked `full-review` plan stage, and record that the prior `stage_resolution_failed` refusal no longer reproduces.
- [x] `v2/docs/v1-behaviors.md` — update the `recoverPlanStage` entry: recovery no longer runs the caller-supplied review step through `executeWorkflow`; it lands the validated on-disk tree itself.
