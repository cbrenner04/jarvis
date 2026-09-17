---
name: intent-prerequisites-refusal-reprompts
---

# Prose Prerequisites refusal on the review-step deferred landing reprompts instead of terminating

Surface: review-row deferred intent landing / resume (`v2/src/execution/workflow-runner.ts` review landing, `v2/src/execution/workflow-runner-resume.ts` `resolveIntentFinalizationResumeContext` / `isReviewLandingRecoveryAttempt`).

## Problem

A Prerequisites-format refusal hit during the review row's deferred landing settled `landing_failed` immediately; `run resume` replayed the same refusal via `resolveIntentFinalizationResumeContext` and the pipeline went terminal `failed` instead of reprompting the agent to fix the file. The existing in-loop reprompt gate (`evaluateIntentSplitLandingGate` in `v2/src/execution/write-loop.ts`) only fires for the initial intent-split step (`promptId === INTENT_SPLIT_PROMPT_ID`) and is not reached by this deferred-landing path.

## Decisions

- The review-step deferred landing gains a reprompt path equivalent to `evaluateIntentSplitLandingGate`: a prose-Prerequisites refusal is classified as a landing-contract violation and reprompts the agent to fix the staged file, settling `landing_failed` only on reprompt-budget exhaustion. Reuse `evaluateIntentSplitLandingGate`'s classification logic if the deferred-landing call site can invoke it directly; otherwise add an equivalent gate at the `resolveIntentFinalizationResumeContext` / review-landing call site.

## Acceptance criteria

- [ ] A test proves a review row's deferred landing (via `resolveIntentFinalizationResumeContext`/`run resume`) hitting a prose (non-`none`) Prerequisites refusal reprompts the agent instead of settling `landing_failed` or terminal `failed` on first failure; it fails against the pre-fix code.

## Documentation updates

- `v2/docs/write-behavior.md` (or the doc owning landing-contract reprompts) — list the Prerequisites-format refusal among reprompted violations.

## Prerequisites

- Intent landing drops an empty or `none` Prerequisites section and still refuses other prose bodies.
