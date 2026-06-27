# Cut new branches from fetched remote base

## Problem

When a jarvis command creates a *new* branch+worktree, `worktree.ts` calls
`bestEffortFetch` (updating `origin/<base>`) and then cuts the branch from the
**local** base name (`git branch <new> <base>`). A stale local base ref leaves
the fresh worktree behind the real base.

Both new-branch creation sites are affected:

- `ensureWorktree` (patch `run`, the "neither exist" path) — `v1/src/worktree.ts:106-110`
- `createManagedWorktree` (`plan`, `intent`, `prompt` worktrees) — `v1/src/worktree.ts:163-167`

The fix: cut from the fetched remote ref `origin/<base>` when it resolves; fall
back to the local base name when it does not (offline, no origin, or no
`origin/<base>` ref). `branchExistsOnOrigin` already reads the remote-tracking
ref and is the existence check to reuse.

## Decisions

- Prefer `origin/<resolvedBase>` as the branch start point; fall back to the local base name when `origin/<resolvedBase>` does not resolve. — rules out unconditionally cutting from `origin/<base>`, which would break offline/no-origin creation that must stay best-effort.
- Apply the origin-preference to the resolved base name regardless of whether the base was auto-detected (`getBaseBranch`) or passed as an explicit `opts.baseBranch`. — rules out limiting the fix to `ensureWorktree` and leaving plan/intent/prompt cutting from a stale local base.
- Existing-branch paths (local or remote branch already named for the worktree) are unchanged. — rules out re-pointing resume/existing-branch worktrees, which must preserve their commits.

## Task checklist

- [ ] In `ensureWorktree`'s new-branch path, choose start point: `origin/<base>` if `branchExistsOnOrigin`, else `<base>`.
- [ ] In `createManagedWorktree`'s new-branch path, apply the same start-point choice to the resolved base.
- [ ] Add tests covering stale-local-base (starts at origin tip) and fetch-fail/no-origin fallback (starts at local base).
- [ ] Update docs.

## Acceptance criteria

- [ ] A new patch worktree (`run`, neither branch nor worktree exists) created while the local base ref is behind `origin/<base>` starts at the `origin/<base>` tip, not the stale local commit.
- [ ] A new plan/intent/prompt worktree created while the local base ref is behind `origin/<base>` starts at the `origin/<base>` tip.
- [ ] When the fetch fails or there is no `origin/<base>` ref (offline / no origin), new-branch creation still proceeds and starts at the local base ref.
- [ ] Resume/existing-branch paths (local or remote branch already named for the worktree) are unchanged: their start point is the existing branch, not the base.
- [ ] `v1/test/plan-worktree.test.ts` stays green (existing creation behavior unchanged by the start-point change).

## Documentation updates

- [ ] `v1/docs/worktrees-and-commits.md`: the "Neither exist" resume-guarantee line states the new branch is cut from the fetched `origin/<base>` (falling back to local base when the fetch/ref is unavailable).
- [ ] `v2/docs/v1-behaviors.md`: record that new branch+worktree creation cuts from `origin/<base>` when resolvable, falling back to the local base name offline, naming `v1/src/worktree.ts` (`ensureWorktree`, `createManagedWorktree`) as the source.
