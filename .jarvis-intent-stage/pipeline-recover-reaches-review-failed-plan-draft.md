---
name: pipeline-recover-reaches-review-failed-plan-draft
---

# Pipeline recover reaches a review-failed plan draft

## Prerequisites

- Plan-stage recovery accepts a completed plan write followed by a failed review and revalidates, reviews, lands, and commits the populated staged tree without invoking the writer.
- A stopped recovery review preserves the staged tree and does not retry automatically.
- A failed plan write or absent valid staged tree remains ineligible for plan-stage recovery.

## Primary implementation surface

- daemon

## Problem

- `pipeline recover` re-resolves a failed default-branch plan stage without its durable predecessor artifacts, so a review-failed stage can refuse with `no preceding workflow artifact` before recovery sees the valid staged draft.
- `pipeline resume` remains the only admitted command and redispatches the writer.

## Behavior

- `jarvis pipeline recover <id> <branch>` resolves a failed plan stage from its branch's durable predecessor artifacts and linked entry run, including `failed`/`harness_failure` after review failure.
- Recovery admits the existing staged draft, invokes only the recovery review/landing path, and settles and advances the same branch on success.
- A stopped recovery leaves the failed stage and staged tree available for inspection, editing, and another explicit recovery attempt.
- `pipeline resume` keeps its existing redraft semantics; write-step failures remain unrecoverable through `pipeline recover`.

## Decisions

- Supply persisted predecessor artifacts when re-resolving default and fan-out recovery targets; rules out an empty artifact map that rejects chained plan stages.
- Continue using the failed stage's linked entry run as recovery identity; rules out accepting an operator-supplied run or the predecessor run as the draft owner.
- Admit `harness_failure` only through the recovery capability's completed-write and intact-stage checks; rules out broad recovery of arbitrary failed plan stages.
- Preserve `pipeline resume` as redispatch and make `pipeline recover` the non-destructive verb; rules out silently changing resume into review-only replay.

## Acceptance criteria

- [ ] `pipeline recover` on a default-branch plan stage whose write completed and review failed no longer returns `stage_resolution_failed: ... no preceding workflow artifact`; it revalidates and lands the existing staged tree without dispatching the write step.
- [ ] The same recovery behavior works for a named fan-out branch without changing sibling rows or approval gates.
- [ ] A failed recovery attempt preserves the failed row linkage and staged tree for operator inspection and another explicit attempt.
- [ ] A write-step failure with no valid staged draft remains refused, and `pipeline resume` continues to redispatch the normal plan workflow.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — recovery resolution and settlement for review-failed plan stages with intact staging.
- `v2/docs/operator-runbook.md` — use `pipeline recover` to revalidate an intact review-failed draft; `pipeline resume` redrafts.
- `v2/docs/v1-behaviors.md` — record the changed pipeline recovery semantics in the v1 parity baseline.
