# Cleanup delegates Git and GitHub operations to typed boundaries

`v2/src/commands/cleanup.ts` stops spawning raw `git`/`gh` argv; it calls `shared/git.ts` and `v2/src/execution/github-operations.ts` with injectable runners and surfaces operation-owner errors to operators.

**Scope:** inline `git`/`gh` migration targets `v2/src/commands/cleanup.ts` only; `cleanup-archive-publication.ts` stays out of scope until a follow-on intent (repo-wide spawn guard is separate).

**Staging grep:** subspecs 00–05 may cite partial `runAsync("git"` / `runAsync("gh"` checks for slices landed in that subspec; [06](./06-cleanup-operation-errors-and-docs.md) owns the zero-spawn invariant for all of `cleanup.ts`.

**Plan of record:** index and subspecs supersede open items in [intent.md](./intent.md) (error propagation vs propagate, no cleanup retry loops, runner + `github-operations` exports rather than a separate injected interface type).

- [x] [00-cleanup-delegates-github-pr.md](./00-cleanup-delegates-github-pr.md) — all `gh` in `cleanup.ts` (probes, gates, open-PR listing, archive publication `gh` seam, abandon `closePr`)
- [x] [01-cleanup-delegates-worktree-branch-ref-push.md](./01-cleanup-delegates-worktree-branch-ref-push.md) — discovery, retirement, abandon teardown, merged-ref pruning, origin probe before remote delete
- [x] [02-shared-git-reads-for-cleanup.md](./02-shared-git-reads-for-cleanup.md) — extend `shared/git.ts` for ref tree/blob reads and counts; migrate cleanup spec-at-ref and diff-name probes
- [x] [03-shared-git-graph-reads-for-stale-reset.md](./03-shared-git-graph-reads-for-stale-reset.md) — ancestor, merge-tree, conflict-path listing, tick-backing `git log -p` reads in `shared/git.ts`
- [x] [04-cleanup-delegates-stale-reset-rewrites.md](./04-cleanup-delegates-stale-reset-rewrites.md) — stale-reset rebase/merge rewrites through typed worktree git operations
- [ ] [05-cleanup-archive-publication-git-adapter.md](./05-cleanup-archive-publication-git-adapter.md) — replace `applyEndArchivePublication`'s inline `git` callback with typed git exports (push stays on the boundary)
- [ ] [06-cleanup-operation-errors-and-docs.md](./06-cleanup-operation-errors-and-docs.md) — operator-facing `GitOperationError`/`GitHubOperationError` wording, durable docs, full `cleanup.ts` spawn invariant

## Prerequisites

- `shared/git.ts` consolidated Git operation boundary (delivered: `shared-git-operations-boundary`).
- Typed GitHub operations boundary with PR list/view/state (delivered: `github-operations-boundary`).
