---
name: review-without-evidence-fails-the-run
---

# A review that produced no evidence fails instead of reporting completed

## Problem

With `reviewPasses >= 1`, a review step that never actually reviewed still reports
`completed`. The operator gets a run that looks reviewed and is not — false
assurance on the exact artifact the gate exists to check. Same family as
`run-cannot-report-complete-over-red-gate`. Compounding it, a boundary violation
fails the run with `failureKind: "error"` and **no message**
(`workflow-runner.ts:1677-1692`), and `getChangedPaths` swallows git errors
(`review-intent-enforcement.ts:100-106`).

## Scope

- `completed` on a review step means the review ran: a critic was invoked and a
  verdict was produced. Absent that, the run fails with a named reason.
- A review step that cannot run — missing or empty workspace
  (`resolveReviewedIntentWorkspace`), unavailable agent — fails rather than
  silently succeeding.
- Boundary-violation and enforcement failures carry an operator-readable message.
- Regression coverage asserts a no-op review yields a failed run, not `completed`.

## Out of scope

- Rendering the intent review prompts.
- The split half of `intent-reviewed`, which works.
- `plan-reviewed*` review phases — blocked on
  `invalid-token-discards-completed-work`; re-test once it lands.

## Documentation updates

- `v2/docs/workflow-runner.md` — when the review phase fails.
- `v2/docs/operator-runbook.md` — remove the "review evidence missing" caveat.

## Prerequisites

- The intent review step invokes its critic with a rendered prompt and produces a verdict artifact.
