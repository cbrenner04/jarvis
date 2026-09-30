# Capture open-PR review threads into a durable artifact

Review feedback on a published lane PR is captured from GitHub into a lane-scoped harness sidecar before a review-feedback workflow run dispatches its write step.

Ordered: `00` gh capture and artifact write; `01` review-feedback workflow-start hook and operator docs.

- [ ] [00 - PR review input capture](./00-pr-review-input-capture.md)
- [ ] [01 - Review-feedback start invokes capture](./01-review-feedback-start-invokes-capture.md)
