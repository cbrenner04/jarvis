---
name: intent-review-prompts-render
---

# Intent review invokes its agents with rendered prompts

## Problem

`buildReviewedIntentWorkflowSteps` sets the review step's `prompt` to the literal
string `"intent.prompt.review"` (`intent-workflow-steps.ts:359-382`), and
`review-cycle.ts:75` passes it straight to the critic as the agent prompt. Nothing
in the intent path resolves the prompt registry, and no `actuatorPromptRenderer` is
supplied (`review-cycle.ts:98`), so `prompts/intent/review.md` and
`prompts/intent/review-actuator.md` are dead artifacts. The critic receives a
meaningless one-line prompt, returns an empty verdict, the actuator never runs, and
the cycle reports `completed` with `actuatorRan: false` — a review that always
passes without reviewing.

`v2/docs/workflow-runner.md:168-169` records this as deferred; it is the defect.

## Scope

- Render the registered intent review critic and actuator prompts at runtime, the
  way `plan-reviewed-light` does via `render-plan-review-prompts.ts`.
- The critic sees the reviewed intents and its verdict path; the actuator sees the
  composed actuator prompt plus the critic verdict.
- Regression coverage asserts the agents were invoked with the rendered prompt
  text, not with a prompt ID, and that a non-empty verdict drives the actuator.

## Out of scope

- Log events for the review step.
- Failing a run whose review produced no evidence.

## Documentation updates

- `v2/docs/workflow-runner.md` — drop the deferred-enforcement caveat; state what
  the intent review phase composes.
- `v2/docs/prompts.md` — intent review prompt layering now matches the code.

## Prerequisites
