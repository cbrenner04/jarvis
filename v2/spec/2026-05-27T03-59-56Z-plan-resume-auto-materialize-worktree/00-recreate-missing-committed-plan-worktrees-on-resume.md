# 00 - Recreate missing committed plan worktrees on resume

## Decisions

- Limit scope to `jarvis1 plan --resume` and `--resume-draft` with `commit: true`.
- Recreate the missing `.worktree/plan-<name>` only on the existing `existsSync(worktreePath)` miss path.
- Reuse one shared existing-branch-only helper for plan resume and review-feedback; do not add a third recreation flow.
- Pass `plan-<name>` worktree naming and `plan/<name>` branch naming into that helper.
- Helper must best-effort `git fetch origin` before probing for `origin/<branch>`.
- Helper must create the `.worktree/` parent before `git worktree add`.
- Helper must return recreated-path provenance as data so callers own log wording.
- Plan resume must log `plan: recreated worktree at <path> from <local|origin>` only after successful recreation.
- Already-present worktrees stay on the current fast path with no fetch and no recreate log.
- If neither local nor origin plan branch exists, preserve the current missing-worktree failure behavior.
- If only the local plan branch exists, recreate the worktree, then preserve the later `origin` requirement failure unchanged.
- If a local and/or origin plan branch exists, recreate the worktree, then leave the existing post-checks unchanged.
- Keep patch-mode `ensureWorktree` behavior unchanged.
- Keep review-feedback semantics unchanged apart from any helper extraction needed to share logic.
- Do not change no-commit plan resume; it does not use plan worktrees.
- Do not relax the later origin-presence check in resume flow.
- Keep user-facing logging recreate-only.

## Task checklist

- Extract or generalize the existing existing-branch worktree recreation helper for plan naming.
- Call the helper from committed plan resume only when the expected worktree path is missing.
- Preserve the current downstream branch and file checks after recreation.
- Add unit coverage for local+remote, remote-only, local-only-no-remote, no-branch, and already-present cases.
- Update the durable operator docs in `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `jarvis1 plan --resume <index.md>` and `--resume-draft <intent.md>` recreate a missing committed plan worktree from `plan/<name>` when the branch exists locally or on `origin`, then continue resume from the restored worktree.
- [ ] The shared helper creates the `.worktree/` parent as needed, fetches before remote-branch detection, and returns source provenance so plan resume can emit `plan: recreated worktree at <path> from <local|origin>` without duplicating branch checks.
- [ ] When the worktree already exists, committed plan resume skips helper invocation, fetch side effects, and recreate logging.
- [ ] When the plan branch exists only locally and not on `origin`, committed plan resume recreates the worktree if missing, then still fails on the preserved later origin check.
- [ ] When neither the local nor remote plan branch exists, committed plan resume still fails with the current missing-worktree semantics.
- [ ] Unit tests cover the present-worktree fast path, local+remote recreation success, remote-only recreation success, local-only recreation plus preserved origin failure, and no-branch failure.
- [ ] `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md` record the committed plan-resume auto-materialization behavior and its preserved origin requirement.

## Documentation updates

- Update `v1/docs/plan-mode.md`.
- Update `v2/docs/v1-behaviors.md`.
