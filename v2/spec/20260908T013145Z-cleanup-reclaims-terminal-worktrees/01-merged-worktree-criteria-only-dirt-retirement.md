# 01 - Retire merged worktrees with criteria-only dirt

## Problem

Merged plan worktrees with redundant chained-implement acceptance-criteria ticks left on disk block bulk retirement with opaque `git worktree remove` failures instead of force-removing criteria-only drift or naming unrelated dirty paths.

## Decision ledger

- Preflight merged-worktree retirement with the same stale-reset helpers: `landedCriteriaAbsentFromBase` / `collectLandedCriteriaDrift` for criteria drift, `listDirtyWorktreePathsForStaleReset` for dirty-path enumeration, `isStaleResetLandedCriteriaSpecPath` for in-root spec admission, and `isHarnessWorkflowStagingPath` for staging exclusions; rules out attempting raw `git worktree remove` on criteria-tick-only dirt or inventing a parallel dirty-path list.
- `baseRef` uses the same resolved `LandedCriteriaSpecTree.baseRef` contract as stale reset (`resolveStaleResetRef` on the lane merge target); rules out a separate merge-base heuristic for cleanup retirement.
- Force-remove a merged worktree only when every dirty path is criteria-tick drift already present on `baseRef` or is excluded as harness workflow staging; rules out discarding unrelated operator changes under the redundant-tick exception.
- Refuse retirement when any dirty path is not criteria-only drift and name every dirty path on stdout; rules out exposing only `Command failed: git worktree remove` or emitting refusal on stderr.
- Deferred to first consumer: out-of-root chained-implement criteria-dirt retirement — pin when a caller needs it.

## Work

- Add a merged-worktree retirement preflight in `performWorktreeRemovals` / `removeWorktreeAndPruneRefs` that classifies dirty paths via `listDirtyWorktreePathsForStaleReset` and criteria drift via `landedCriteriaAbsentFromBase` on an in-root `v2/spec/` tree gated by `isStaleResetLandedCriteriaSpecPath`.
- Use `git worktree remove --force` only for the criteria-only case; preserve the worktree and emit named-path refusal on stdout for other dirt.
- Add paired in-repo `v2/spec/` fixtures: criteria-only drift retires safely; unrelated dirt is preserved with named paths.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `merged plan worktree with landed criteria-only dirt retires safely` proves redundant chained-implement ticks under in-repo `v2/spec/` permit retirement, while a sibling fixture with unrelated dirt is preserved and reports its paths on stdout; it fails against the pre-fix raw `git worktree remove` error.
- [ ] `v2/docs/operator-runbook.md` documents criteria-only drift force-retirement and unrelated-dirt refusal paths for merged-worktree cleanup.
- [ ] `v2/docs/v1-behaviors.md` records the merged-worktree criteria-dirt retirement delta.

## Documentation updates

- `v2/docs/operator-runbook.md` — criteria-dirt retirement and refusal paths under merged-worktree retirement.
- `v2/docs/v1-behaviors.md` — criteria-only drift exception for bulk merged-worktree removal.
