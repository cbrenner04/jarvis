# Retire iter-0 orphan worktree/branch and clear litter on re-run

## Problem

After an iter-0 agent-error, the worktree + branch created by `ensureWorktree`
sit at base with zero commits — an orphan. `ensureWorktree` reuses any existing
worktree dir, so a re-run either collides or resumes on top of stale agent litter
(stray untracked files), and the #520 no-commit reset is a no-op for git-enabled
runs. Today the operator must manually `git worktree remove --force` +
`git branch -D` before re-running.

Normalize the consumer side: on `jarvis1 run <index.md>`, retire an iter-0
orphan worktree+branch and clear agent litter so the run starts clean, while
preserving any committed WIP branch for resume.

## Dependency

- Depends on subspec 00 (commit-WIP-on-agent-error). 00 changes what constitutes litter in a resumed worktree: it stages all non-ignored untracked files into the WIP commit, so a resumed WIP worktree's residual litter is by construction the gitignored set. Test setup here must assume 00's behavior is in place.

## Decisions

- Retire (remove worktree + delete branch) only when the residual branch has zero commits ahead of base — an orphan; a branch with commits (WIP from subspec 00) is preserved and resumed. Rules out destroying WIP progress by blindly removing residual worktrees.
- After retiring, a fresh worktree+branch is created normally (existing `ensureWorktree` no-branch path). Rules out leaving the operator with no checkout.
- "Agent litter" = untracked files including gitignored ones (`git clean -fdx` semantics), cleared before the agent iterates. For a resumed WIP worktree this is specifically the gitignored set (e.g. `test_output.txt`), since 00 already committed every non-ignored untracked file; for a recreated orphan it covers any stray untracked files. Rules out a non-ignored-only definition that would be empty-by-construction in a resumed WIP worktree and test nothing.
- `git worktree remove --force` / `git branch -D` failure (branch checked out elsewhere, FS error) aborts the run with a named error rather than proceeding into a collision. Rules out silently continuing past a failed retirement and recreating onto a half-removed worktree.
- Only the orphan (branch+worktree both present, zero commits) and preserved-WIP (branch with commits + its worktree) states are handled. Degenerate partial states — branch without worktree, worktree without branch — are out of scope and left to existing `ensureWorktree` behavior. Rules out silently inventing recovery for states this spec does not exercise.
- Detection uses base-branch comparison, not iteration counters. Rules out relying on per-run state that does not survive across invocations.
- Applies to git-enabled runs; no-commit runs keep the #520 delta reset. Rules out double-cleaning no-commit state.

## Task checklist

- [ ] Before/within worktree resolution for a re-run, detect an orphan: existing branch+worktree with no commits ahead of the base branch.
- [ ] Retire the orphan (`git worktree remove --force` + `git branch -D`) then let normal creation make a fresh worktree+branch; on retirement failure, abort with a named error.
- [ ] For a preserved (WIP-committed) worktree being resumed, clear untracked litter including gitignored files before iterating.
- [ ] Add tests for: orphan retired+recreated, WIP branch preserved+resumed, litter cleared.

## Acceptance criteria

- [x] A `jarvis1 run <index.md>` against a spec whose worktree+branch is an iter-0 orphan (branch at base, zero commits ahead) starts cleanly without the operator running `git worktree remove --force` or `git branch -D` first.
- [x] When the residual branch has commits (a WIP branch from agent-error), the re-run preserves it and resumes from the WIP commit rather than retiring it.
- [x] Agent litter (untracked files including gitignored ones, e.g. `test_output.txt`) in the resumed/recreated worktree is cleared before the agent's first iteration.
- [x] When `git worktree remove --force` or `git branch -D` fails during orphan retirement, the run aborts with a named error and does not recreate onto a half-removed worktree.
- [x] New tests in `v1/test` cover orphan-retired-and-recreated, WIP-branch-preserved-and-resumed, litter-cleared (gitignored file gone in a resumed WIP worktree), and retirement-failure-aborts.
- [x] `v1/test/plan-worktree.test.ts` "reuses a checkout already on the patch spec branch" stays green (non-orphan reuse behavior unchanged).

## Documentation updates

- [x] `v1/docs/run-loop.md`: document re-run normalization — orphan worktree/branch retired, WIP branch resumed, litter cleared — under the resume / re-run behavior section.
- [x] `v1/docs/worktrees-and-commits.md`: note the re-run orphan-retire and litter-clear in the worktree lifecycle.
- [x] `v1/docs/operator-runbook.md`: drop/adjust the manual `git worktree remove --force` + `git branch -D` recovery step now that re-run handles it.
- [x] `v2/docs/v1-behaviors.md`: record re-run orphan retirement, WIP preservation, and litter clearing as current v1 behavior.
