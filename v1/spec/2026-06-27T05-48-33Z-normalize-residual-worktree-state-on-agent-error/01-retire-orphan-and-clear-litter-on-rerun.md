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

## Decisions

- Retire (remove worktree + delete branch) only when the residual branch has zero commits ahead of base — an orphan; a branch with commits (WIP from subspec 00) is preserved and resumed. Rules out destroying WIP progress by blindly removing residual worktrees.
- After retiring, a fresh worktree+branch is created normally (existing `ensureWorktree` no-branch path). Rules out leaving the operator with no checkout.
- "Agent litter" = untracked, non-ignored files in a reused/resumed worktree; clear them before the agent iterates. Rules out resuming on top of stray files (e.g. `test_output.txt`) that mislead the agent.
- Detection uses base-branch comparison, not iteration counters. Rules out relying on per-run state that does not survive across invocations.
- Applies to git-enabled runs; no-commit runs keep the #520 delta reset. Rules out double-cleaning no-commit state.

## Task checklist

- [ ] Before/within worktree resolution for a re-run, detect an orphan: existing branch+worktree with no commits ahead of the base branch.
- [ ] Retire the orphan (`git worktree remove --force` + `git branch -D`) then let normal creation make a fresh worktree+branch.
- [ ] For a preserved (WIP-committed) worktree being resumed, clear untracked litter before iterating.
- [ ] Add tests for: orphan retired+recreated, WIP branch preserved+resumed, litter cleared.

## Acceptance criteria

- [ ] A `jarvis1 run <index.md>` against a spec whose worktree+branch is an iter-0 orphan (branch at base, zero commits ahead) starts cleanly without the operator running `git worktree remove --force` or `git branch -D` first.
- [ ] When the residual branch has commits (a WIP branch from agent-error), the re-run preserves it and resumes from the WIP commit rather than retiring it.
- [ ] Agent litter (untracked, non-ignored files) in the resumed/recreated worktree is cleared before the agent's first iteration.
- [ ] New tests in `v1/test` cover orphan-retired-and-recreated, WIP-branch-preserved, and litter-cleared.
- [ ] Existing `ensureWorktree` reuse tests stay green (non-orphan reuse behavior unchanged).

## Documentation updates

- [ ] `v1/docs/run-loop.md`: document re-run normalization — orphan worktree/branch retired, WIP branch resumed, litter cleared — under the resume / re-run behavior section.
- [ ] `v1/docs/worktrees-and-commits.md`: note the re-run orphan-retire and litter-clear in the worktree lifecycle.
- [ ] `v1/docs/operator-runbook.md`: drop/adjust the manual `git worktree remove --force` + `git branch -D` recovery step now that re-run handles it.
- [ ] `v2/docs/v1-behaviors.md`: record re-run orphan retirement, WIP preservation, and litter clearing as current v1 behavior.
