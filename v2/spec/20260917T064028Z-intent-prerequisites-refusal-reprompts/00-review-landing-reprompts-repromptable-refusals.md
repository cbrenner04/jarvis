# Review-step deferred landing reprompts repromptable refusals

## Problem

A prose (non-`none`) Prerequisites refusal during the review row's deferred intent landing settles `landing_failed`; `run resume` (`resolveIntentFinalizationResumeContext` in `v2/src/execution/workflow-runner-resume.ts`) replays the same refusal and the pipeline goes terminal `failed`. Only the intent-split write loop (`evaluateIntentSplitLandingGate` in `v2/src/execution/write-loop.ts`) reprompts such violations.

## Decisions

- Classify with the existing `isRepromptableIntentLandingError` / `evaluateIntentSplitLandingGate` result (`repromptable`); do not add a second Prerequisites-specific matcher — rules out drift between the two landing paths.
- A repromptable refusal on review-step deferred landing (initial landing and resume replay) re-invokes the agent via the registered `write.landing-contract-reprompt` prompt with the validation message and offending staged file, then re-validates; non-repromptable errors (rogue path, collision, I/O) keep settling `landing_failed` immediately.
- `landing_failed` settles only when the reprompt budget is exhausted — rules out settling on first failure.
- Deferred to first consumer: reprompt budget size for the review-landing path — pin when a caller needs it; reuse the step's existing iteration budget if one is reachable at the call site, else one reprompt.
- Each reprompt appends a `landing_contract_reprompt` log event, same shape as the write-loop path — rules out an untraceable review-side reprompt.

## Acceptance criteria

- [ ] A new test drives a review row's deferred intent landing through `run resume` (`resolveIntentFinalizationResumeContext`) with a staged intent whose `## Prerequisites` body is prose, and asserts the agent is reprompted with `write.landing-contract-reprompt` instead of the run settling `landing_failed` or the pipeline going terminal `failed` on first failure; it fails against the pre-fix code.
- [ ] A test asserts that after the reprompted agent fixes the staged file, landing succeeds; and that a non-repromptable landing error (rogue path) still settles `landing_failed` without a reprompt.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — in the landing violation taxonomy, state that the review-step deferred landing (including `run resume` replay) reprompts agent-fixable violations, including prose Prerequisites refusals, via `write.landing-contract-reprompt`.
- `v2/docs/v1-behaviors.md` — record that deferred-landing Prerequisites refusals now reprompt instead of terminating.
