---
name: commit-false-rerun-hygiene
---

# `commit:false` re-runs need manual spec/worktree reset between attempts

## Problem

Under `commit:false`, a run ticks acceptance criteria in the **source** spec and appends a
`## Blocker` on failure, but leaves the worktree behind. So re-running the same spec after a
friction-blocked attempt requires the operator to, by hand: reset the ticked `- [ ]` checkboxes,
strip the stale `## Blocker`, and clean up the prior worktree — before each retry. Observed in
groceries (`SESSION_REPORT.md`, "commit:false re-run hygiene is manual"), where re-runs were the
common case (#13 took ~6 attempts, #24 took 3), so this manual reset dominated the babysitting.

These are exactly the manual steps the north star wants eliminated — a re-run should be a single
jarvis command, not a checkbox-reset + blocker-strip + worktree-cleanup ritual.

## Direction

Make a `commit:false` re-run self-resetting. Options for plan to weigh:

- On re-run of an incomplete spec, auto-revert AC checkboxes ticked by the prior (uncommitted)
  attempt and strip the prior attempt's `## Blocker` before starting.
- Reuse or clean the prior worktree automatically instead of leaving an orphan.
- A `jarvis run --retry` / `--fresh` affordance that does the reset deterministically, vs. baking it
  into the default re-run path.

## Out of scope

- Changing the `commit:false` model itself (operator-merges-only, one-PR-per-item stays).

## References

- `v1/src/modes/patch/run.ts` — AC-tick + `## Blocker` append on the source spec.
- `v1/docs/worktrees-and-commits.md` — worktree lifecycle.
- Observed 2026-06-22/23 on groceries (`../groceries/specs/jarvis/SESSION_REPORT.md`).
