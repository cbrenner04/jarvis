# 00 - Write patch active spec marker

Patch runs create or reuse `.worktree/<spec-name>/`, but production preflight does not write `.active-spec-path`. Triage and `triage --merge` spec-path resolution depend on that marker, so fresh patch worktrees look like pre-marker worktrees until some other path backfills it.

## Decisions

- Write the marker from patch preflight after `ensureWorktree` and `prepareActiveSpecPath`, not inside `ensureWorktree` — rules out coupling generic worktree creation to patch spec identity.
- Write `.active-spec-path` as an untracked worktree-local file — rules out committing identity metadata to implementation branches.
- Skip marker writes when effective `git:false` or `skipGhCheck` bypasses worktree setup — rules out creating marker files in loop-only or test-skipped main-checkout runs.

## Tasks

- Add patch preflight marker writing for git-backed patch worktrees after the active spec path is prepared.
- Preserve resume behavior by rewriting the marker when the resolved active spec path changes.
- Ensure git status stays clean after marker creation.
- Add regression coverage for fresh worktree creation, resume/rewrite, and skipped worktree setup.
- Update durable v1 behavior docs.

## Acceptance criteria

- [ ] A git-backed `jarvis1 run <index.md>` fresh patch worktree contains `.active-spec-path` with the same active spec path produced for the agent prompt.
- [ ] Re-running a git-backed patch run against an existing patch worktree rewrites `.active-spec-path` when the resolved active spec path changes.
- [ ] `.active-spec-path` is not committed or staged by marker creation.
- [ ] Effective `git:false` runs and worktree-skipped preflight do not write `.active-spec-path`.
- [ ] Patch-run regression tests cover marker creation, rewrite, and skipped-write cases.
- [ ] `v2/docs/v1-behaviors.md` records that git-backed patch preflight populates `.active-spec-path` in patch worktrees.

## Documentation updates

- `v2/docs/v1-behaviors.md`: add patch-mode behavior for `.active-spec-path` marker population and skip cases.
