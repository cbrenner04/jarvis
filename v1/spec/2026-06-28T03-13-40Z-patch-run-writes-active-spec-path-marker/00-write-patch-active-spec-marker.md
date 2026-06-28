# 00 - Write patch active spec marker

Patch runs create or reuse `.worktree/<spec-name>/`, but production preflight does not write `.active-spec-path`. Triage and `triage --merge` spec-path resolution depend on that marker, so fresh patch worktrees look like pre-marker worktrees until some other path backfills it.

## Decisions

- Write the marker from patch preflight after `ensureWorktree` and `prepareActiveSpecPath`, not inside `ensureWorktree` — rules out coupling generic worktree creation to patch spec identity.
- Write the exact active spec path value returned by `prepareActiveSpecPath`, including external absolute specs — rules out a separate marker path format.
- Keep `.active-spec-path` worktree-local without changing tracked ignore files — rules out hiding the marker by mutating repository ignore metadata.
- Skip marker writes when effective `git:false` or worktree setup is bypassed — rules out creating marker files in loop-only or main-checkout runs.

## Tasks

- Add patch preflight marker writing for git-backed patch worktrees after the active spec path is prepared.
- Preserve resume behavior by rewriting the marker when the resolved active spec path changes.
- Ensure marker creation leaves tracked ignore files unchanged and the marker unstaged/uncommitted.
- Add regression coverage for fresh worktree creation, external absolute spec paths, resume/rewrite, and skipped worktree setup.
- Update durable v1 behavior docs.

## Acceptance criteria

- [ ] A git-backed `jarvis1 run <index.md>` fresh patch worktree contains `.active-spec-path` with the same active spec path value produced for the agent prompt.
- [ ] Git-backed patch runs for external specs write `.active-spec-path` with the external absolute active spec path value produced for the agent prompt.
- [ ] Re-running a git-backed patch run against an existing patch worktree rewrites `.active-spec-path` when the resolved active spec path changes.
- [ ] Marker creation leaves repository-tracked ignore files unchanged and does not stage or commit `.active-spec-path`.
- [ ] Effective `git:false` runs and worktree-skipped preflight do not write `.active-spec-path`.
- [ ] Patch-run regression tests cover marker creation, rewrite, and skipped-write cases.
- [ ] Patch-run regression tests cover in-repo and external absolute active spec path marker values.
- [ ] `v2/docs/v1-behaviors.md` records that git-backed patch preflight populates `.active-spec-path` in patch worktrees and that `git:false` or worktree-skipped runs do not.

## Documentation updates

- `v2/docs/v1-behaviors.md`: add patch-mode behavior for `.active-spec-path` marker population and skip cases.
