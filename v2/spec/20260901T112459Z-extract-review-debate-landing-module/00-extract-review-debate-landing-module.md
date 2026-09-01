# Extract review-debate landing module

## Problem

Review-debate step execution, post-debate landing orchestration, and actuator-only retry live inline in `workflow-runner.ts`, inflating the file targeted for resume-machine extraction and mixing dispatch with landing settlement.

## Surface

Primary: `v2/src/execution/workflow-runner-debate-landing.ts` (new). In-scope: `workflow-runner.ts` step-dispatch wiring, `workflow-runner-debate-landing-structure.test.ts`, `execution-terminal-settlement-guard.test.ts`.

## Decisions

- New sibling module `workflow-runner-debate-landing.ts` owns review-debate landing orchestration plus debate-local helpers (`finishReviewDebateLanding`, `buildReviewDebateLandingActuatorContext`, `commitReviewDebateOutcome`, staged-markdown lint/reprompt helpers consumed by `landReviewedOutputOrFail`); rules out leaving any of that inline in `workflow-runner.ts` after the move.
- No review-debate landing band (~lines 2289–3225 on main) may remain in `workflow-runner.ts`; rules out satisfying only entrypoint pins while transitive helpers stay inline.
- Move `runReviewDebateStep`, `tryActuatorOnlyReviewDebateRetry`, `landReviewedOutputOrFail`, and `finishReviewedLanding` out of `workflow-runner.ts`; rules out a partial move that leaves any of the four private inline helpers reachable in `workflow-runner.ts` (all four are private inline helpers reachable on main today).
- Export `runReviewDebateStep`, `landReviewedOutputOrFail`, and `finishReviewedLanding` for `workflow-runner.ts` import; rules out re-exporting through `workflow-runner.ts` as the landing home.
- Inject stay-behind helpers via `ReviewDebateLandingDeps` from `workflow-runner.ts` call sites (`findReviewLandingCheckpoint`, `reviewCompletionAgent`, `reviewCompletionPass`, `raceStepSuccessorShellIdle`); rules out debate-landing importing `workflow-runner.ts` and rules out a new shared internal module in this slice.
- Move `buildStandardReviewLandingActuatorContext`, `buildCheckpointReviewLandingActuatorContext`, and `settleReviewedStagedMarkdownLintFailure` with landing helpers; export `settleReviewedStagedMarkdownLintFailure` for `settleIntentResumeStagedMarkdownLintFailure` until resume extraction; rules out splitting checkpoint dispatch or resume settlement from their landing callers.
- `finalizeStandardReviewStep` imports `buildStandardReviewLandingActuatorContext` from `workflow-runner-debate-landing.ts`; rules out duplicating the standard builder in `workflow-runner.ts`.
- Keep `landReviewedPublicationOutput`, `findReviewLandingCheckpoint`, resume machines, and the step loop in `workflow-runner.ts`; rules out extracting shared review-landing promotion or resume machines in this slice (follow-on `extract-workflow-runner-resume-machines` owns those).
- Behavior-preserving extraction only; rules out settlement-semantics redesign ([[pipeline-settlement-derives-from-run-rows]] owns that).
- Structure guard pins entrypoints plus debate-local helpers (`finishReviewDebateLanding`, `commitReviewDebateOutcome`, `buildReviewDebateLandingActuatorContext`, `repromptReviewedStagedMarkdownLintOrFail`); rules out line-count-only or export-list-only extraction checks.

## Task checklist

- Create `v2/src/execution/workflow-runner-debate-landing.ts` and move review-debate landing orchestration plus its private helpers out of `workflow-runner.ts`.
- Define `ReviewDebateLandingDeps` and pass stay-behind helpers from `workflow-runner.ts` into `runReviewDebateStep` and `tryActuatorOnlyReviewDebateRetry`.
- Export `runReviewDebateStep`, `landReviewedOutputOrFail`, and `finishReviewedLanding`; keep `workflow-runner.ts` step dispatch importing `runReviewDebateStep` and light-review landing callers importing the shared landing entrypoints.
- Add `workflow-runner-debate-landing-structure.test.ts` asserting `runReviewDebateStep`, `tryActuatorOnlyReviewDebateRetry`, `landReviewedOutputOrFail`, `finishReviewedLanding`, `finishReviewDebateLanding`, `commitReviewDebateOutcome`, `buildReviewDebateLandingActuatorContext`, and `repromptReviewedStagedMarkdownLintOrFail` are not defined in `workflow-runner.ts`.
- Reconcile `execution-terminal-settlement-guard.test.ts` permitted-write paths for moved landing functions including `settleReviewedStagedMarkdownLintFailure`.

## Acceptance criteria

- [ ] `workflow-runner-debate-landing-structure.test.ts` fails if `runReviewDebateStep`, `tryActuatorOnlyReviewDebateRetry`, `landReviewedOutputOrFail`, `finishReviewedLanding`, `finishReviewDebateLanding`, `commitReviewDebateOutcome`, `buildReviewDebateLandingActuatorContext`, or `repromptReviewedStagedMarkdownLintOrFail` remain defined in `workflow-runner.ts` (all eight are private inline helpers reachable on main today).
- [ ] `execution-terminal-settlement-guard.test.ts` stays green after permitted-write paths follow moved landing functions into `workflow-runner-debate-landing.ts`.
- [ ] `workflow-runner-review.test.ts` stays green (shared `landReviewedOutputOrFail` / `finishReviewedLanding` staged-markdown lint and checkpoint re-entry cases unchanged by the extraction).
- [ ] `workflow-runner-review-standard.test.ts` stays green (standard-review landing paths unchanged by the extraction).
- [ ] `bun run typecheck` passes.

## Documentation updates

None — module-map doc lands in subspec 02.
