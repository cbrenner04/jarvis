# 01 — Cleanup delegates worktree, branch, ref, and remote push

## Problem

Discovery, merged-worktree retirement, merged-branch ref pruning, and `--abandon` teardown in `cleanup.ts` still build `git worktree`, `git branch`, `git update-ref`, and `git push` argv inline despite typed owners in `shared/git.ts`.

## Decisions

- Map calls to existing exports: `listWorktrees`, `removeWorktree`, `pruneWorktrees`, `deleteBranch`, `deleteRef`, `resolveRef`, `gitCommonDir`, `isInsideWorkTree`, `diffNameOnly`, `mergeBase`, `pushBranch`, `originTrackingRefResolvesAsync` — rules out reintroducing porcelain parsers that `listWorktrees` already owns.
- `deleteRemoteBranch` probes `origin` via new `shared/git.ts` `remoteUrl` (`git remote get-url <name>`) before `pushBranch` delete; missing `origin` keeps today's success path with the same stdout (`No origin remote; remote branch … already absent`) — rules out inline `runAsync("git", ["remote", "get-url", "origin"]` (~line 4460) or changing abandon semantics when no remote exists.
- Post-remove `worktree prune` after successful remove stays best-effort (errors swallowed) — rules out failing retirement when prune alone fails (reachable in `performAbandonmentSteps` today).
- `deleteRemoteBranch` keeps treating `pushBranch` `already-absent` and missing `origin` as success — rules out changing abandon semantics when remote is gone.
- `resolveGitCommonDir` delegates to `gitCommonDir` and deletes the local wrapper — rules out duplicate `rev-parse --git-common-dir` parsing.
- `parseCheckedOutBranchesFromWorktreePorcelain` may remain for tests/helpers only if `listWorktrees` supersedes production porcelain reads — rules out two worktree-list parsers on the hot path.

## Task checklist

- Add `remoteUrl` (or equivalent) to `shared/git.ts` with `GitOperationError` classification + `shared/git.test.ts` coverage.
- Migrate `discoverWorktreesInProject`, `removeWorktreeAndPruneRefs`, `performAbandonmentSteps`, `pruneStaleOriginRemoteTrackingRef`, merged-branch ref discovery helpers, `deleteRemoteBranch`, and `hasCommonAncestor` (via `mergeBase` try/catch) off inline `git` spawns.
- Update `cleanup.test.ts` retirement and abandon tests to mock typed git operations where they currently key on `git worktree remove` argv (e.g. `removal guards are load-bearing: git worktree remove is essential`).

## Acceptance criteria

- [x] `shared/git.test.ts` adds `remoteUrl` coverage; fails against pre-fix boundary missing that export.
- [x] `cleanup.test.ts` test `removal guards are load-bearing: git worktree remove is essential` fails against pre-fix code when updated to simulate `GitOperationError` from `removeWorktree` instead of a generic `git worktree remove` failure; passes after migration and asserts stderr still reports retirement failure without removing the worktree.
- [x] `cleanup.test.ts` test `abandon retires an unmerged workspace via git worktree remove --force, branch -D, and push origin --delete` stays green (behavior unchanged aside from delegation).
- [x] `cleanup.ts` contains no `runAsync("git", ["worktree"` or `["branch", "-D"` or `["push", "origin", "--delete"` or `["remote", "get-url"` inline spawns — staging slice only; full-file invariant is [06](./06-cleanup-operation-errors-and-docs.md).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Deferred to [06 — Cleanup operation errors and docs](./06-cleanup-operation-errors-and-docs.md).
