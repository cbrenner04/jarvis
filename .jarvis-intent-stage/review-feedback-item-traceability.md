---
name: review-feedback-item-traceability
---

# Review-feedback runs report addressed and unaddressed items by name

## Problem

A review-feedback run can finish without recording which PR review items it touched, so operators cannot see silent skips.

## Behavior

When a review-feedback run settles, durable run output and the operator-visible summary list which captured review items were addressed and name any captured items left unaddressed. Unaddressed items are never dropped silently.

## Acceptance criteria

- [ ] A regression test fails against the pre-fix run finalization and proves addressed items and named unaddressed items appear in the run record and summary when the write step clears only a subset of captured items.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — reading addressed versus unaddressed review items after a run.
- `v2/docs/v1-behaviors.md` — review-feedback re-entry capability and traceability contract.

## Prerequisites

- The preset registry records whether each registered CLI workflow may be used as a pipeline stage `workflow` value, and pipeline definition validation rejects stage workflows marked standalone-only with a named error.
- PR review threads and comments for a lane's open PR are captured into one durable review artifact via `gh`, with the PR as the sole feedback source.
- Review-feedback CLI admission resolves a completed plan or implement lane to its branch, worktree, and open PR and refuses in-flight lanes, closed or merged PRs, and non-plan/implement targets by name.
- The review-feedback preset write step addresses captured PR feedback on the admitted branch and republishes through the normal ready gate and completion publication to the same open PR without implement spec-routing scope.
