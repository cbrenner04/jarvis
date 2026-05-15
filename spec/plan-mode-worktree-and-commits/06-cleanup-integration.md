# 06 — Cleanup integration for plan worktrees

## Problem

`jarvis cleanup` removes merged patch-mode worktrees and branches
(`docs/worktrees-and-commits.md#cleanup`). Plan-mode worktrees
(`.worktree/plan-<name>/`) and branches (`plan/<name>`) follow the same
lifecycle: once the plan PR is merged on origin, the local worktree and
branch are dead weight. They should be cleaned up by the same command.

## Decisions

- **No new command.** Cleanup is integrated into existing
  `jarvis cleanup`, not a separate `jarvis cleanup --plan` subcommand.
- **Detection rule.** A worktree is plan-mode if its directory name
  matches `plan-*` under `.worktree/`. The associated branch is
  `plan/<directory-name-without-plan-prefix>`. Cross-check via the
  worktree's `git rev-parse --abbrev-ref HEAD` to make sure we are not
  removing a worktree on the wrong branch.
- **Patch-mode naming restriction.** Patch-mode worktree directory
  names (which match the spec name) **may not** start with `plan-`.
  This is the constraint that lets the cleanup detection rule above
  be a simple prefix check. Enforce it at the patch-mode worktree
  creation site — `ensureWorktree` in `src/worktree.ts` (called from
  `src/modes/patch/run.ts`). If the resolved spec name starts with
  `plan-`, throw with message `spec name must not start with
  \`plan-\`; that prefix is reserved for plan mode` so the existing
  catch in `runCommand` surfaces it as the standard `failed to
  create or resume worktree:` error and exits `1`. One-line guard;
  add it as part of this subspec since the constraint is what makes
  the cleanup logic safe. The new plan-mode helper added in
  subspec 01 must not enforce this guard for itself.
- **Merged condition.** Same logic as patch mode: `isMergedPr` in
  `src/commands/cleanup.ts` already queries `gh pr view <branch>
  --json state -q .state` and only matches `MERGED`. PRs in `OPEN`,
  `CLOSED`, or `DRAFT` state are left alone. (Plan-mode PRs spend
  most of their life in `DRAFT`; cleanup only touches them after a
  human marks ready and merges.) For plan worktrees, pass the mapped
  branch name (`plan/<name>`) to `isMergedPr`, not the directory name.
- **Removal action.** Same as patch: `git worktree remove
  .worktree/plan-<name>` and `git branch -d plan/<name>` (lower-case
  `-d`, matching the existing cleanup code; don't switch to `-D`,
  which would force-delete unmerged branches and risk dropping work
  if the PR-state check ever drifts). Skip silently if either is
  already gone.
- **Dirty plan worktrees** are treated the same as dirty patch
  worktrees: cleanup's existing `hasDirtyStatus` check (uncommitted
  changes or unpushed commits) refuses removal and prints the
  existing `skipping <name>: has uncommitted or unpushed changes`
  line. No special-case behavior for plan. (Pointing the user at
  `jarvis triage` is out of scope here; if we want that nudge, it's
  a follow-up to the cleanup output and applies to patch worktrees
  too.)
- **Dry-run support.** The existing `--dry-run` (already in
  `cleanupCommand` via `opts.dryRun`) lists plan worktrees it would
  remove alongside patch worktrees, with a `(plan)` tag appended to
  the line in the `Worktrees to remove:` section for clarity. The tag
  is rendered for the non-dry-run path too, so the confirmation
  prompt and the `removed <name>` lines also disambiguate.
- **No new flag** is added.

## Implementation hints

- `cleanupCommand` in `src/commands/cleanup.ts` enumerates
  `.worktree/*` (filtering out `.keep`) and assumes `branch ==
  worktreeName` everywhere — the `toRemove` records carry
  `{ path, branch }` with `branch` set to the directory name and that
  same string is then passed to `isMergedPr` and `git branch -d`.
  Introduce a small `branchForWorktree(dir)` helper that returns
  `plan/<...>` for `plan-*` directories and `<dir>` otherwise, and
  thread it through the existing flow. Patch-mode worktrees keep the
  same end-to-end behavior since the helper returns `<dir>` for them.

## Tasks

- [ ] Update cleanup enumeration to recognize `plan-*` worktrees and
  map them to `plan/<name>` branches.
- [ ] Update merged-detection to query the right branch.
- [ ] Update dry-run output to tag plan worktrees with `(plan)`.
- [ ] Add the `plan-` prefix guard to patch-mode worktree creation
  so the cleanup detection rule remains a safe prefix check.
- [ ] Tests:
  - Merged plan PR + clean plan worktree → both removed.
  - Open/draft plan PR → worktree left alone.
  - Dirty plan worktree → refused with the existing advice text.
  - Dry-run lists plan worktrees with the `(plan)` tag and does not
    remove anything.
  - Patch-mode cleanup behavior is unchanged on plain `<name>`
    worktrees.
  - Patch-mode worktree creation refuses a spec name starting with
    `plan-` with the documented error.

## Acceptance criteria

- [ ] `jarvis cleanup` removes `.worktree/plan-<name>/` and
  `plan/<name>` when the corresponding PR is merged.
- [ ] `jarvis cleanup --dry-run` distinguishes plan worktrees with a
  `(plan)` tag in its output.
- [ ] Patch-mode worktree creation rejects spec names starting with
  `plan-` with the documented actionable error.
- [ ] Patch-mode cleanup behavior is unchanged.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 07 covers docs.
