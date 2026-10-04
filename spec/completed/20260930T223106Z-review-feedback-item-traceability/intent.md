---
name: review-feedback-item-traceability
---

# Review-feedback runs report addressed, declined, and unaddressed capture ids

## Problem

A review-feedback run can finish without recording which captured PR review items (`threadId` / `commentId` from `.jarvis-pr-review-input.json`) were addressed, declined, or left without a sidecar line, so operators cannot see silent skips.

## Behavior

When a review-feedback run settles, durable run output and the operator-visible summary list addressed, declined, and unaddressed capture ids. Unaddressed capture ids are never dropped silently.

## Acceptance criteria

- [ ] A regression test fails against the pre-fix run finalization and proves addressed, declined, and unaddressed capture ids appear in the run record and operator summary when the write step sidecar clears only a subset of captured ids.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — reading addressed, declined, and unaddressed capture ids after a run (ids are the operator-facing item identifier).
- `v2/docs/v1-behaviors.md` — review-feedback re-entry versus v1 (`review-feedback` worktree-name CLI, PR comments plus CI-failure path): v2 is preset-based lane admission by branch (and pipeline disambiguators) for completed intent/plan/implement lanes with a reviewed open PR, PR review threads/comments only, automatic capture on admit, and addressed/declined/unaddressed capture-id traceability.

## Prerequisites

- The preset registry records whether each registered CLI workflow may be used as a pipeline stage `workflow` value, and pipeline definition validation rejects stage workflows marked standalone-only with a named error.
- Review-feedback admission resolves the lane and runs the capture prelude before write-step dispatch.
- Review-feedback CLI admission resolves a completed intent, plan, or implement lane to its branch, worktree, and open PR with at least one review, and refuses in-flight lanes, PRs with no review, closed or merged PRs, and other workflow kinds by name.
- The review-feedback preset write step addresses captured PR feedback on the admitted intent, plan, or implement branch and republishes through the normal ready gate and completion publication to the same open PR without implement spec-routing scope.
