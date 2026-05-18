# 02 — `commit: false` plan flow

When `commit` resolves to `false`, skip worktree creation, all git commits, and PR creation. Write the spec tree directly into the main checkout under `spec/<specDirBasename>/` and print a local-path summary at the end.

## Context

The target use case is git repos where spec files should live only on disk and never be committed. The repo is still a valid git repo with an `origin`; the `origin`/`gh` dependency is simply being removed from the plan workflow for these repos. This path is **not** intended to support non-git directories.

The existing `skipGhCheck` test option already proves this structural shape is sound — `commit: false` is the production-grade variant.

### Structural approach

`worktreePath` is the variable all downstream write calls use (e.g. `seedIntentFile`, draft output, review output). In the normal flow, `createPlanWorktree` sets `worktreePath` to the newly created worktree path. The no-commit flow short-circuits this: set `worktreePath = project.root` before reaching the worktree block, then skip the block entirely. Nothing else in the write path needs to change — all writes already use `worktreePath`.

`plan.ts:799` calls `createPlanWorktree` inside `if (!opts.skipGhCheck && isGitRepo)`. When `commit` is `false`:

- Set `worktreePath = project.root` (the main checkout) and skip the entire `createPlanWorktree` block.
- Guard every `commitPlan*` and `ensureDraftPr` / `updatePrBody` call with the resolved `commit` flag; skip them when `false`.
- Skip the early `gh auth status` check (currently paired with the `createPlanWorktree` block via `skipGhCheck`); gate it on `commit` for the same reason.

`ensureUniquePlanName` still runs when `commit` is `false` — it checks branches and worktrees, which is harmlessly conservative (no branch is created, so the suffix logic may produce a slightly different name than strictly necessary, but will not fail). The disk-collision guard (below) is separate and handles the case `ensureUniquePlanName` does not cover.

### Disk-collision guard

`ensureUniquePlanName` checks branches and worktrees but not disk directories. With `commit: false`, two back-to-back `jarvis plan my-feature` runs would both resolve to `spec/my-feature/` and the second would silently overwrite the first. After `specDirBasename` is computed and `commit` is `false`, check whether `project.root/spec/<specDirBasename>/` already exists. If it does, exit with a clear error:

> `spec/<specDirBasename>/ already exists. Rename or remove it before running again.`

### Final summary output

Replace the PR URL summary with a local-path message:

> `Spec written to spec/<specDirBasename>/index.md`  
> `Run with: jarvis run spec/<specDirBasename>/index.md`

### `jarvis run` compatibility

`jarvis run` reads spec files directly from disk, so it works against a locally written spec without the spec being committed or merged. The merge-first rule in spec-guidance.md explicitly does not apply to no-commit specs.

## Tasks

- [x] Call `resolvePlanFlags(cfg, project)` and destructure `{ commit }` — the same call should also destructure `specTimestamp` (see subspec 01); there must be exactly one `resolvePlanFlags` call in the plan flow, not one per flag
- [x] Gate the early `gh auth status` / availability check on `commit` (skip when `false`)
- [x] When `commit` is `false`, skip `createPlanWorktree` and set `worktreePath = project.root`
- [x] After `specDirBasename` is computed and `commit` is `false`, check for an existing `project.root/spec/<specDirBasename>/` directory and exit with a descriptive error if found
- [x] Guard every `commitPlanInterview`, `commitPlanDraft`, `commitPlanReview`, `commitPlanBlocker` (and any other `commit*`) call with the `commit` flag
- [x] Guard every `ensureDraftPr` and `updatePrBody` call with the `commit` flag
- [x] When `commit` is `false`, print the local-path summary instead of the PR URL at the end of the flow
- [x] Verify that interview, draft, and review phases still run and produce files under `project.root/spec/<specDirBasename>/` when `commit` is `false`

## Acceptance criteria

- [x] `jarvis plan` with `commit: false` in config completes without touching git (no new commits, no new branch, no worktree, no PR)
- [x] The spec tree is written to `project.root/spec/<specDirBasename>/` and `index.md` is present and valid
- [x] The final output points the user to `spec/<specDirBasename>/index.md` with a `jarvis run` command
- [x] Running `jarvis plan` a second time with the same name and `commit: false` exits with the disk-collision error rather than silently overwriting
- [x] The `gh` CLI is never invoked when `commit: false` (no auth check, no PR creation, no push)
- [x] All three phases (interview, draft, review) still execute and produce output files
- [x] `jarvis run spec/<specDirBasename>/index.md` works correctly against the locally written spec
- [x] The `commit: false` path requires the directory to be a git repo (`isGitRepo` is `true`); `commit: false` does not enable running `jarvis plan` in non-git directories — that use case is out of scope
