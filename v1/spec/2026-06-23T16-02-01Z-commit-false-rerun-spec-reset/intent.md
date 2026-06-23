---
name: commit-false-rerun-spec-reset
---

# Auto-reset source-spec state on `commit:false` re-run

## Problem

Under `commit:false`, a friction-blocked attempt leaves the source spec mutated: AC
checkboxes the prior (uncommitted) attempt ticked stay ticked, and the prior `## Blocker`
stays appended. Re-running the same spec then requires the operator to hand-revert those
checkboxes and strip the stale blocker before each retry. Observed on groceries where
re-runs were the common case, so this reset dominated the babysitting.

## Direction

On re-run of an incomplete `commit:false` spec, restore the source spec to its
pre-attempt state automatically: revert AC checkboxes the prior uncommitted attempt
ticked, and strip that attempt's `## Blocker`. Plan to weigh: bake into the default
re-run path vs. gate behind an explicit `--retry`/`--fresh` affordance. The reset must
not touch checkboxes ticked in earlier committed/operator state — only the prior
uncommitted attempt's changes.

## Out of scope

- Worktree reuse/cleanup (separate behavior).
- Changing the `commit:false` model itself (operator-merges-only, one-PR-per-item stays).

## References

- `v1/src/modes/patch/run.ts` — AC-tick + `## Blocker` append on the source spec.

## Prerequisites

- A `commit:false` patch run ticks acceptance-criteria checkboxes in the source spec and appends a `## Blocker` on failure.
