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
  creation site (in whatever helper `runCommand` calls): if the
  resolved spec name starts with `plan-`, exit `1` with `spec name
  must not start with \`plan-\`; that prefix is reserved for plan
  mode`. This is a one-line guard in the patch-mode worktree
  creator; add it as part of this subspec since the constraint is
  what makes the cleanup logic safe.
- **Merged condition.** Same logic as patch mode: query `gh pr view
  <branch> --json state,mergedAt` and remove only when state is
  `MERGED`. PRs in `OPEN`, `CLOSED`, or `DRAFT` state are left alone.
  (Plan-mode PRs spend most of their life in `DRAFT`; cleanup only
  touches them after a human marks ready and merges.)
- **Removal action.** Same as patch: `git worktree remove
  .worktree/plan-<name>` and `git branch -D plan/<name>`. Skip silently
  if either is already gone.
- **Dirty plan worktrees** are treated the same as dirty patch
  worktrees: cleanup refuses to remove them and prints the same advice
  (point at `jarvis triage`). No special-case behavior for plan.
- **Dry-run support.** `jarvis cleanup --dry-run` lists plan worktrees
  it would remove, alongside patch worktrees, with a `(plan)` tag in
  the listing for clarity.
- **No new flag** is added.

## Implementation hints

- The cleanup command likely already enumerates `.worktree/*` and
  filters by some criterion. Extend the enumeration to also accept
  `plan-*` entries with the right branch-name mapping.
- If the cleanup code currently hardcodes `branch = directoryName`,
  introduce a small `branchForWorktree(dir)` helper that returns
  `plan/<...>` for `plan-*` directories and `<dir>` otherwise.

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
