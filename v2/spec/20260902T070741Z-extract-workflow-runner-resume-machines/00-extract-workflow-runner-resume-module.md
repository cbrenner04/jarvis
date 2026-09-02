# Extract workflow-runner resume module

## Problem

Plan recovery, intent-finalization resume, review-mutation resume, and shared `landReviewedPublicationOutput` promotion (~1,600 lines) live inline in `workflow-runner.ts`, blocking review of the step loop and debate-landing seams.

## Surface

Primary: `v2/src/execution/workflow-runner-resume.ts` (new). In-scope: `workflow-runner.ts` import wiring, `workflow-runner-debate-landing.ts` `landReviewedPublicationOutput` dep source, all merge-base consumers of moved exports (`daemon.ts`, `pipeline-stage-recovery.ts`, `pipeline-stage-recovery.test.ts`, `pipeline-execution.test.ts`, `daemon-resume.test.ts`, `daemon-pipeline-recover.test.ts`, `workflow-runner-review.test.ts`, `workflow-runner-resume.test.ts`, `workflow-runner-plan.test.ts`, `recover-review-failed-plan-draft.test.ts`), `workflow-runner-resume-structure.test.ts`.

## Decision ledger

- One sibling module `workflow-runner-resume.ts` owns plan recovery, both publication resume machines, `landReviewedPublicationOutput`, and their private helpers; rules out splitting production resume code across multiple modules in this slice.
- Move the full resume band (~`recordIntentFinalization` through `resumeReviewMutationFinalization` on merge-base) plus exported admission helpers (`hasPopulatedIntentStage`, `hasPopulatedPlanStage`, `isPlanStageEntryRunRecoverable`, `resolveIntentFinalizationResumeContext`, `resolveReviewMutationLineageContext`, `resolveReviewMutationResumeContext`, `resolveWriteOutOfScopeResumeContext`, `resolveExhaustedRedResumeContext`, and associated types); rules out leaving any resume block or promotion helper inline in `workflow-runner.ts`.
- Stay behind in `workflow-runner.ts`: `findReviewLandingCheckpoint`, `reviewCompletionAgent`, `reviewCompletionPass`, `persistIntentHandoff`, and `recordIntentFinalization` (each is called from the step loop and/or `REVIEW_DEBATE_LANDING_DEPS` today); rules out moving shared step-loop helpers into resume or letting resume import `workflow-runner.ts`.
- Move `restoreVerdictSidecars` with `landReviewedPublicationOutput`; rules out leaving resume-only promotion helpers inline.
- Inject stay-behind helpers into resume (`persistIntentHandoff`, `recordIntentFinalization`, `reviewCompletionAgent`, `reviewCompletionPass` where the resume band reads them today) and `settleReviewedStagedMarkdownLintFailure` from `workflow-runner-debate-landing.ts`; rules out resume importing `workflow-runner.ts` and rules out a new shared internal module in this slice.
- `reviewCompletionAgent` and `reviewCompletionPass` remain defined in `workflow-runner.ts` and are wired into `REVIEW_DEBATE_LANDING_DEPS` from there; rules out moving them into resume or re-exporting through `workflow-runner.ts` as the resume home.
- Export the four structure-guard entrypoints plus every daemon-callable resume symbol moved from `workflow-runner.ts`; rules out hiding resume ownership behind `workflow-runner.ts` re-exports.
- `workflow-runner.ts` keeps the step loop and imports resume entrypoints for internal call sites (`REVIEW_DEBATE_LANDING_DEPS.landReviewedPublicationOutput`, standard-review landing); rules out debate-landing or the step loop importing resume helpers from anywhere except `workflow-runner-resume.ts`.
- Preserve twin settlement implementations (`settleIntentResume*` vs `settleReviewMutationResume*`) unchanged; rules out merging intent-finalization and review-mutation settlement in this slice.
- `resumable` projection semantics stay as-is until the follow-on merge intent; rules out changing daemon admission or `loop_finished.resumable` derivation here.
- Structure guard pins exported entrypoints plus nine resume-local private helpers (`settleIntentResumeFailure`, `settleReviewMutationResumeFailure`, `resolveReviewMutationRowHead`, `admitPlanRecoveryBlockerAndClaim`, `restoreVerdictSidecars`, `settleIntentResumeStagedMarkdownLintFailure`, `inertResumeWriteLoopInput`, `mutationRepairLoopInput`, `settleSuccessfulReviewMutationPublication`); rules out line-count-only or four-entrypoint-only extraction checks.
- Behavior-preserving extraction only; rules out settlement-semantics redesign.

## Task checklist

- Create `workflow-runner-resume.ts` and move plan recovery, intent-finalization resume, review-mutation resume, `landReviewedPublicationOutput`, and their private helpers out of `workflow-runner.ts`.
- Define resume injection for stay-behind helpers (`persistIntentHandoff`, `recordIntentFinalization`, `reviewCompletionAgent`, `reviewCompletionPass`) and `settleReviewedStagedMarkdownLintFailure`.
- Rewire `workflow-runner.ts` and `workflow-runner-debate-landing.ts` to import moved symbols from `workflow-runner-resume.ts`.
- Re-point every merge-base consumer of moved exports (production and test files listed under Surface) to import from `workflow-runner-resume.ts`.
- Add `workflow-runner-resume-structure.test.ts` asserting the four exported entrypoints and nine resume-local private helpers are not defined in `workflow-runner.ts`.

## Acceptance criteria

- [x] `workflow-runner-resume-structure.test.ts` fails against the pre-fix tree and fails if `recoverPlanStage`, `resumePopulatedIntentPublication`, `resumeReviewMutationFinalization`, `landReviewedPublicationOutput`, `settleIntentResumeFailure`, `settleReviewMutationResumeFailure`, `resolveReviewMutationRowHead`, `admitPlanRecoveryBlockerAndClaim`, `restoreVerdictSidecars`, `settleIntentResumeStagedMarkdownLintFailure`, `inertResumeWriteLoopInput`, `mutationRepairLoopInput`, or `settleSuccessfulReviewMutationPublication` remain defined in `workflow-runner.ts` (all thirteen are inline helpers reachable on main today).
- [x] `recover-review-failed-plan-draft.test.ts` stays green after `recoverPlanStage` imports move to `workflow-runner-resume.ts`.
- [x] `workflow-runner-debate-landing.test.ts` stays green after `landReviewedPublicationOutput` dep wiring sources `workflow-runner-resume.ts`.
- [x] `workflow-runner-resume.test.ts` stays green after moved-symbol imports re-point to `workflow-runner-resume.ts`.
- [x] `workflow-runner-review.test.ts` stays green after moved-symbol imports re-point to `workflow-runner-resume.ts`.
- [x] `daemon-resume.test.ts` stays green after moved-symbol imports re-point to `workflow-runner-resume.ts`.
- [x] `daemon-pipeline-recover.test.ts` stays green after `recoverPlanStage` imports move to `workflow-runner-resume.ts`.
- [x] `pipeline-execution.test.ts` stays green after `landReviewedPublicationOutput` imports move to `workflow-runner-resume.ts`.
- [x] `workflow-runner-publication.test.ts` stays green (no moved-symbol imports on merge-base).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

None — module-map doc lands in subspec 03.
