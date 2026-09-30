# Review-feedback dispatch

## Problem

CLI admission stops with `review_feedback_write_not_available` after successful preparation; no run executes the write loop.

## Prerequisites

- Subspecs `00-review-feedback-write-prompt-corpus.md` and `01-review-feedback-workflow-step-and-bindings.md`.

## Decisions

- Remove the post-preparation stub refusal in `runReviewFeedbackWorkflowCommand`; successful admission dispatches through the same daemon workflow start path as other presets (`prepareWorkflowStart` → IPC) — rules out a second ad-hoc runner.
- `review_feedback_write_not_available` remains only for `prepareWorkflowStart` / start-path preparation failures after lane resolution and capture succeed — rules out steady-state “not implemented” refusal on an otherwise prepared workflow.
- Admission refuses `review_feedback_pr_not_draft` when the lane PR is open but not a draft and the lineage has no harness ready-flip evidence (operator-flipped); the prelude's `gh pr view` also reads `isDraft` — rules out re-drafting an operator-flipped PR or failing late with `OpenPrNotDraftError` in publication.
- Update admission tests to expect successful dispatch (run row created, no post-preparation `review_feedback_write_not_available`) when the daemon stub accepts start — rules out leaving stub refusal as terminal behavior.

## Tasks

- Wire CLI and daemon admission to dispatch prepared review-feedback steps after `prepareReviewFeedbackWorkflowAdmission` succeeds.
- Add the `review_feedback_pr_not_draft` check to the admission prelude.
- Refresh `review-feedback-workflow-admission.test.ts` end-to-end expectations for dispatch.

## Acceptance criteria

- [x] `review-feedback-workflow-admission.test.ts` test that previously expected `review_feedback_write_not_available` after successful preparation instead asserts workflow dispatch without that code; fails against the pre-fix stub refusal in `runReviewFeedbackWorkflowCommand`.
- [x] `review-feedback-admission-prelude.test.ts` case: a non-draft lane PR without harness ready-flip evidence refuses `review_feedback_pr_not_draft`; a draft PR, or a non-draft PR with that evidence, admits. Fails against the pre-fix prelude.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- None.
