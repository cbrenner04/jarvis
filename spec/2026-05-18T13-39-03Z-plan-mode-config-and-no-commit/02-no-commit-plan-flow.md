# 02 — `commit: false` plan flow

When `commit` resolves to `false`, skip worktree creation, all git commits, and PR creation. Write the spec tree directly into the main checkout under `spec/<specDirBasename>/` and print a local-path summary at the end.

## Context

The target use case is git repos where spec files should live only on disk and never be committed. The repo is still a valid git repo with an `origin`; the `origin`/`gh` dependency is simply being removed from the plan workflow for these repos. This path is **not** intended to support non-git directories.

The existing `skipGhCheck` test option already proves this structural shape is sound — `commit: false` is the production-grade variant.

### Structural approach

`plan.ts:799` calls `createPlanWorktree` inside `if (!opts.skipGhCheck && isGitRepo)`. When `commit` is `false`:

- Skip the entire `createPlanWorktree` block.
- Set `worktreePath = project.root` so downstream writes (e.g. `seedIntentFile`, draft output) land in the main checkout.
- Guard every `commitPlan*` and `ensureDraftPr` / `updatePrBody` call with the resolved `commit` flag; skip them when `false`.
- Skip the early `gh auth status` check (currently paired with the `createPlanWorktree` block via `skipGhCheck`); gate it on `commit` for the same reason.

### Disk-collision guard

`ensureUniquePlanName` checks branches and worktrees but not disk directories. With `commit: false`, two back-to-back `jarvis plan my-feature` runs would both resolve to `spec/my-feature/` and the second would silently overwrite the first. After `specDirBasename` is computed and `commit` is `false`, check whether `project.root/spec/<specDirBasename>/` already exists. If it does, exit with a clear error:

> `spec/<specDirBasename>/ already exists. Rename or remove it before running again.`

### Final summary output

Replace the PR URL summary with a local-path message:

> `Spec written to spec/<specDirBasename>/index.md`  
> `Run with: jarvis run spec/<specDirBasename>/index.md`

## Tasks

- [ ] Call `resolvePlanFlags(cfg, project)` and destructure `{ commit }` (may be combined with the `specTimestamp` call from subspec 01)
- [ ] Gate the early `gh auth status` / availability check on `commit` (skip when `false`)
- [ ] When `commit` is `false`, skip `createPlanWorktree` and set `worktreePath = project.root`
- [ ] After `specDirBasename` is computed and `commit` is `false`, check for an existing `project.root/spec/<specDirBasename>/` directory and exit with a descriptive error if found
- [ ] Guard every `commitPlanInterview`, `commitPlanDraft`, `commitPlanReview`, `commitPlanBlocker` (and any other `commit*`) call with the `commit` flag
- [ ] Guard every `ensureDraftPr` and `updatePrBody` call with the `commit` flag
- [ ] When `commit` is `false`, print the local-path summary instead of the PR URL at the end of the flow
- [ ] Verify that interview, draft, and review phases still run and produce files under `project.root/spec/<specDirBasename>/` when `commit` is `false`

## Acceptance criteria

- [ ] `jarvis plan` with `commit: false` in config completes without touching git (no new commits, no new branch, no worktree, no PR)
- [ ] The spec tree is written to `project.root/spec/<specDirBasename>/` and `index.md` is present and valid
- [ ] The final output points the user to `spec/<specDirBasename>/index.md` with a `jarvis run` command
- [ ] Running `jarvis plan` a second time with the same name and `commit: false` exits with the disk-collision error rather than silently overwriting
- [ ] The `gh` CLI is never invoked when `commit: false` (no auth check, no PR creation, no push)
- [ ] All three phases (interview, draft, review) still execute and produce output files
- [ ] `jarvis run spec/<specDirBasename>/index.md` works correctly against the locally written spec
- [ ] The `commit: false` path requires the directory to be a git repo (`isGitRepo` is `true`); behavior in a non-git directory is unchanged
