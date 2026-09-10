---
name: branch-resume-admits-skipped-successor-lane
---

# Branch-scoped resume admits a lane whose only undone work is a provisional `skipped` successor

## Problem

`scanBranchSuffixForAdmission` admits only through a replayable `failed` row and otherwise falls through to `not_resumable`. A lane at `plan: succeeded` + `implement: skipped` has no failed row, so `jarvis pipeline resume <id> <branch>` refuses `branch_not_resumable` even though the lane plainly has undone work. `pipeline recover` needs a failed plan stage and refuses too, and `skipped` is terminal so nothing ages it out.

## Decisions

- Branch resume admission treats a branch whose last satisfied stage has an unsatisfied provisional `skipped` successor as admissible, reopening the successor rather than a failed predecessor.
- Admission still refuses branches whose only `skipped` successors are terminal split-retired rows.
- Existing failed-row admission behavior is unchanged.

## Acceptance criteria

- [ ] A pipeline test proves branch-scoped resume admits a branch at `succeeded` + provisional `skipped` successor and dispatches that successor; it fails against the pre-fix `branch_not_resumable` refusal.
- [ ] A pipeline test proves a branch whose only later rows are terminal split-retired `default` rows still refuses.
- [ ] Existing `scanBranchSuffixForAdmission` failed-row admission tests stay green (behavior unchanged for that path).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — branch resume admission for skipped-successor lanes.
- `v2/docs/operator-runbook.md` — retire the "abandon and dispatch standalone" workaround for this shape.

## Prerequisites

- Stage rows record whether a `skipped` row is provisional (predecessor failure) or terminal (split-retired).
- The state store exposes a branch-scoped reopen of provisional `skipped` rows to `pending` that needs no `failed` anchor row.
- Settling a branch stage to `succeeded` reopens that branch's provisional `skipped` successors.
