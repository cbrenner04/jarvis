# Review-feedback dispatch

## Problem

CLI admission stops with `review_feedback_write_not_available` after successful preparation; no run executes the write loop.

## Prerequisites

- Subspecs `00-review-feedback-write-prompt-corpus.md` and `01-review-feedback-workflow-step-and-bindings.md`.

## Decisions

- Remove the post-preparation stub refusal in `runReviewFeedbackWorkflowCommand`; successful admission dispatches through the same daemon workflow start path as other presets (`prepareWorkflowStart` → IPC) — rules out a second ad-hoc runner.
- `review_feedback_write_not_available` remains only for `prepareWorkflowStart` / start-path preparation failures after lane resolution and capture succeed — rules out steady-state “not implemented” refusal on an otherwise prepared workflow.
- Update admission tests to expect successful dispatch (run row created, no post-preparation `review_feedback_write_not_available`) when the daemon stub accepts start — rules out leaving stub refusal as terminal behavior.

## Tasks

- Wire CLI and daemon admission to dispatch prepared review-feedback steps after `prepareReviewFeedbackWorkflowAdmission` succeeds.
- Refresh `review-feedback-workflow-admission.test.ts` end-to-end expectations for dispatch.

## Acceptance criteria

- [ ] `review-feedback-workflow-admission.test.ts` test that previously expected `review_feedback_write_not_available` after successful preparation instead asserts workflow dispatch without that code; fails against the pre-fix stub refusal in `runReviewFeedbackWorkflowCommand`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- None.
