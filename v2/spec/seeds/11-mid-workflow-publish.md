# Mid-workflow publish after plan draft

**Sequencing:** land inside or after `workflow-composable-collapse`. Option A adds a
per-step flag to the publication seam the collapse rewrites; adding it to
`intent-workflow-steps.ts` / `plan-workflow-steps.ts` first would bolt it onto
builders the collapse deletes.

## Problem

v1 opens a draft PR after `plan: draft` commit, before review. v2 write loop
publishes only on step `complete`. Plan workflows need commit + draft PR between
draft and review steps when `git: true`.

## Scope

Per-step `publishOnComplete` on write steps — the plan draft step commits and opens
its draft PR before the review step runs, in the same daemon run.

- `publishOnComplete` as a write-step property, resolved by the publication seam
  (post-collapse: a column on the publication row, not a branch in the runner).
- Plan draft step sets it when `git: true`; review steps do not.
- A mid-run publish failure must fail the step, not be swallowed — a draft PR that
  was supposed to exist and does not is the work-loss case this seed exists to close.
- Publication is idempotent across the draft and completion publishes on one branch:
  the completion publish updates the existing PR rather than opening a second.

## Decisions

- **Option A — per-step publish.** Rules out B (documenting a two-launch
  `plan` → `plan-review-*` operator path). B leaves the draft output uncommitted and
  unpublished until the review step completes, so anything that kills the run between
  draft and review — a daemon bounce, a kill, a stalled reviewer — **destroys the
  drafted plan**. v1 publishes after `plan: draft` for exactly this reason. A run
  should never hold completed work hostage to a later step.
- Publish on the draft step's completion, not on workflow completion. Rules out
  deferring publication to the end, which is the current v2 behavior and the bug.

## Prerequisites

- `plan` draft workflow merged (seed 04).
- At least one plan review preset merged (seed 07 or 08).

## Out of scope

- Intent workflow publish changes.
- Implement publish (already on write completion).

## Reference

- `.scratch/v2-operator-workflows.md` — Mid-workflow git/PR, open question #2

## Documentation updates

- Operator doc — plan PR cadence matches chosen decision
