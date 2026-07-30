# Document merged branch-ref cleanup

## Problem

The durable operator documentation still describes cleanup as worktree-bound
and says v2 bulk cleanup never touches remote refs.

## Decision ledger

- Document the actual local-only distinction: cleanup deletes eligible local heads and local `origin` tracking refs, never a branch on the remote repository.
- State that merged-PR pruning is worktree-independent, while protected/current/checked-out branches, non-merged or unverifiable PRs, and orphan tracking refs remain untouched.
- Document dry-run and apply reporting, project identity, and nonzero partial-failure behavior.

## Task checklist

- [ ] Update the v2 operator runbook with merged-branch pruning scope, exclusions, local-only ref scope, reporting, and failure behavior.
- [ ] Update the v1-behavior comparison with v2's worktree-independent merged-head and local tracking-ref pruning.
- [ ] Run the required v2 verification after the preceding implementation slices land.

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` states what `jarvis cleanup` prunes, deliberately keeps, previews, and reports, including local-only `origin` tracking-ref pruning and partial failure behavior.
- [x] `v2/docs/v1-behaviors.md` replaces the claim that v2 bulk cleanup never touches remote refs: it never deletes a remote branch, but prunes eligible local `origin` tracking refs and merged local heads independently of worktrees.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md`
- `v2/docs/v1-behaviors.md`
