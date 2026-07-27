---
name: stale-remote-tracking-ref-no-longer-resolves-branch
---

# Re-dispatch after a preflight reset starts from `--base`, not a stale `origin/<branch>`

## Problem

Preflight reset removes the worktree, deletes the local branch, and reports the remote branch
`already absent` — truthfully, since the PR was squash-merged and GitHub deleted the head branch. But
`refs/remotes/origin/<branch>` survives locally, and materialization's remote check
(`branchExistsOnOriginAsync`, `shared/git.ts:93`) is `git rev-parse --verify origin/<branch>` — a
purely local lookup. So `v2/src/execution/external-worktree.ts:158` sees "branch exists on origin",
runs `git branch <name> origin/<name>`, and recreates the branch at pre-merge history instead of
`--base`.

The 2026-07-25 incident is exactly this: the branch had been pushed and merged by hand, leaving the
remote-tracking ref behind.

## Decisions

- After a preflight reset, no local ref — including the remote-tracking ref — may resolve the branch
  name; the next materialization for the same `(project, branch)` starts from `--base`. Rules out
  fixing only the local-branch delete path.
- A remote-tracking ref for a ref that no longer exists on origin must not be treated as evidence the
  branch exists remotely. Rules out trusting `rev-parse origin/<branch>` as a remoteness check.
- Preserve the legitimate case: a branch that really does exist on origin is still checked out from
  it, so cross-machine resumes keep working.

## Acceptance criteria

- [ ] A re-dispatch for the same `(project, branch)` after a preflight reset bases its worktree on
      `--base`, proven by a regression that seeds a stale local branch and a stale
      `refs/remotes/origin/<branch>` beforehand.
- [ ] A branch that still exists on origin is still materialized from the remote branch.
- [ ] Preflight reset reports what it removed for the branch name, including the remote-tracking ref.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — a hand-pushed, hand-merged run branch leaves a
  remote-tracking ref; what reset now clears.
- `v2/docs/v1-behaviors.md` — remote-branch existence is no longer inferred from the local
  remote-tracking ref alone.

## Prerequisites

- Incomplete re-dispatch preflight calls `resetStaleWorkspace`, which retires via
  `performAbandonmentSteps` (worktree + local branch + remote delete today).
- Worktree materialization calls `branchExistsOnOriginAsync` before choosing `--base` vs
  `origin/<branch>` (today implemented as local `rev-parse` on `origin/<branch>` — corrected in
  this spec).

## Sequencing

Same seam as [[materialization-base-drift-guard]] (`external-worktree.ts`,
`branchExistsOnOriginAsync`) and [[cleanup-prunes-merged-dead-branches]] (remote-tracking ref
lifecycle). Plan and land this one first — it's the root cause of the 2026-07-25 incident; the
drift guard is defense-in-depth on the same code and should plan against this one's merged result.
