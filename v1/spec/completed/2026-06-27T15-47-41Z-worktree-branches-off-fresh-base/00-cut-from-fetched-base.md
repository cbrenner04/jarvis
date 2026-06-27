# Cut new branches from fetched remote base

## Problem

When a jarvis command creates a *new* branch+worktree, `worktree.ts` calls
`bestEffortFetch` (updating `origin/<base>`) and then cuts the branch from the
**local** base name (`git branch <new> <base>`). A stale local base ref leaves
the fresh worktree behind the real base.

Both new-branch creation sites are affected:

- `ensureWorktree` (patch `run`, the "neither exist" path) — `v1/src/worktree.ts:106-110`
- `createManagedWorktree` (`plan`, `intent`, `prompt` worktrees) — `v1/src/worktree.ts:163-167`

The fix: cut from the remote-tracking ref `origin/<base>` when it resolves
locally; fall back to the local base name when it does not. The resolution
check is `branchExistsOnOrigin(projectRoot, base)` — it reads the local
`origin/<base>` ref, so the guard is ref-resolution, not the outcome of the
current fetch. A prior successful fetch that left `origin/<base>` present keeps
cutting from that ref even when the current fetch fails (the stale
remote-tracking ref is used intentionally); the fallback fires only when no
`origin/<base>` ref resolves (no origin, or never fetched).

## Decisions

- Prefer `origin/<resolvedBase>` as the branch start point; fall back to the local base name when `origin/<resolvedBase>` does not resolve locally (i.e. `branchExistsOnOrigin(projectRoot, resolvedBase)` is false). — rules out keying the fallback on the fetch outcome, which would wrongly fall back when a fetch fails but a usable stale `origin/<base>` ref still resolves.
- Apply the origin-preference to the resolved base name regardless of whether the base was auto-detected (`getBaseBranch`) or passed as an explicit `opts.baseBranch`. — rules out limiting the fix to `ensureWorktree` and leaving plan/intent/prompt cutting from a stale local base.
- Existing-branch paths (local or remote branch already named for the worktree) are unchanged. — rules out re-pointing resume/existing-branch worktrees, which must preserve their commits.

## Task checklist

- [ ] In `ensureWorktree`'s new-branch path, choose start point: `origin/<base>` if `branchExistsOnOrigin(projectRoot, base)` (the base, not the new worktree branch), else `<base>`.
- [ ] In `createManagedWorktree`'s new-branch path, apply the same start-point choice keyed on `branchExistsOnOrigin(projectRoot, resolvedBase)`.
- [ ] Add tests covering stale-local-base (starts at origin tip) and the `origin/<base>`-absent fallback — no origin, and ref never fetched — (starts at local base).
- [ ] Update docs.

## Acceptance criteria

- [x] A new patch worktree (`run`, neither branch nor worktree exists) created while the local base ref is behind `origin/<base>` starts at the `origin/<base>` tip, not the stale local commit.
- [x] A new plan/intent/prompt worktree created while the local base ref is behind `origin/<base>` starts at the `origin/<base>` tip.
- [x] With no remote `origin` configured, new-branch creation still proceeds and starts at the local base ref.
- [x] With `origin/<base>` absent locally (never fetched), new-branch creation still proceeds and starts at the local base ref.
- [x] Resume/existing-branch paths (local or remote branch already named for the worktree) are unchanged: their start point is the existing branch, not the base.
- [x] `v1/test/plan-worktree.test.ts` stays green (existing creation behavior unchanged by the start-point change).

## Documentation updates

- [ ] `v1/docs/worktrees-and-commits.md`: in the *Neither exist* subsection, the resume-guarantee line states the new branch is cut from `origin/<base>` when it resolves locally (falling back to the local base name when no `origin/<base>` ref resolves).
- [ ] `v2/docs/v1-behaviors.md`: record that new branch+worktree creation cuts from `origin/<base>` when it resolves locally, falling back to the local base name when no `origin/<base>` ref resolves, naming `v1/src/worktree.ts` (`ensureWorktree`, `createManagedWorktree`) as the source.
