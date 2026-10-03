# 04 — Cleanup delegates stale-reset worktree rewrites

## Problem

Stale-reset continuation logic in `cleanup.ts` uses abortable `rebase`/`merge` argv sequences and related rewrite ref updates inline.

## Decisions

- Add typed exports to `shared/git.ts` for abortable worktree rebase/merge pairs (building on graph reads from [03](./03-shared-git-graph-reads-for-stale-reset.md)) — rules out keeping `abortableWorktreeGitRewrite` on raw argv arrays.
- Rewrite helpers document statefulness and that abort runs best-effort after conflicts — rules out changing conflict-path reporting when abort fails (reachable in `abortableWorktreeGitRewrite` today).
- `deleteRef` for `ORIG_HEAD` after a clean merge uses typed `deleteRef` with absent treated as success — rules out new errors on already-cleared `ORIG_HEAD`.

## Task checklist

- Implement worktree rewrite git exports + `shared/git.test.ts` coverage.
- Migrate `carriesNoUnlandedCommits`, `abortableWorktreeGitRewrite`, `rebaseWorktreeOntoBase`, `mergeWorktreeWithBase`, and remaining `diff --diff-filter=U` inline spawns not covered in [03](./03-shared-git-graph-reads-for-stale-reset.md).
- Add or extend `cleanup.test.ts` for continuation/squash-merge behavior if no existing test pins delegation; prefer extending a test that already exercises `carriesNoUnlandedCommits` outcomes.

## Acceptance criteria

- [ ] `shared/git.test.ts` covers abortable rebase/merge rewrite helpers; fails against pre-fix missing exports.
- [ ] `cleanup.test.ts` test `resetStaleWorkspace aborts a conflicting rebase and refuses, leaving the lane unchanged` stays green (behavior unchanged by delegation).
- [ ] `cleanup.test.ts` adds `stale reset rebase delegates to typed worktree rewrite operations` that spies on shared git rewrite exports during the conflicting rebase path; fails against pre-fix `abortableWorktreeGitRewrite` inline `runAsync("git", ["rebase"`.
- [ ] `cleanup.ts` contains no `runAsync("git", ["rebase"` or `["merge", "--no-edit"` — staging slice only; full-file invariant is [06](./06-cleanup-operation-errors-and-docs.md).
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:v2` pass.

## Documentation updates

- Deferred to [06 — Cleanup operation errors and docs](./06-cleanup-operation-errors-and-docs.md).
