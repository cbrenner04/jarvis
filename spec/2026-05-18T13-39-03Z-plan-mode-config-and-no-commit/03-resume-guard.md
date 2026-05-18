# 03 — `--resume` guard for no-commit specs

`jarvis plan --resume` against a no-commit spec should fail fast with a clear error rather than crashing on a missing worktree or branch.

## Context

`prepareResume` (`plan.ts:275`) hard-checks for `.worktree/plan-<planName>`, the `plan/<planName>` branch, and remote branch existence. None of these exist for a spec created with `commit: false`. Without this guard, `--resume` would produce a confusing error about a missing worktree or branch rather than explaining the incompatibility.

The `commit: false` path targets git repos where specs are intentionally local-only. `--resume` is incompatible with this path; the user should use `jarvis run` to continue work on the spec.

## Detection approach

When `prepareResume` is entered:
1. Resolve the project for the spec path.
2. Call `resolvePlanFlags(cfg, project)` to get the `commit` flag.
3. If `commit` is `false`, exit immediately with:
   > `This spec was created with commit: false. Use \`jarvis run <specPath>\` to continue working on it.`

Alternatively (or additionally), detect the structural absence: if neither the expected worktree directory nor the `plan/<planName>` branch exists, and `commit` is `false` for the resolved project, emit the same message. This avoids a false positive if someone passes a spec path from a different project where `commit` happens to be `false`.

## Tasks

- [ ] In `prepareResume` (`plan.ts:275`), resolve the project for the spec path and call `resolvePlanFlags`
- [ ] If `commit` resolves to `false`, exit with the descriptive error message before any worktree or branch checks
- [ ] Confirm the error message names the `jarvis run` alternative so the user knows what to do next

## Acceptance criteria

- [ ] `jarvis plan --resume spec/<name>/index.md` where `<name>` belongs to a project with `commit: false` exits immediately with the descriptive error
- [ ] The error message explicitly mentions `commit: false` and suggests `jarvis run`
- [ ] `jarvis plan --resume` against a normal (commit-enabled) spec is unaffected
- [ ] The guard fires before any git operations (no worktree lookup, no branch check, no remote check)
