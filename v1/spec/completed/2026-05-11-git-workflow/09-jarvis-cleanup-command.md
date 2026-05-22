# 09 - jarvis cleanup command

## Problem

Merged-PR worktrees accumulate under `.worktree/`. Users need an explicit,
safe way to prune them without manual `git worktree remove` gymnastics.

## Decisions

- New command: `jarvis cleanup`.
- Behavior:
  1. Enumerate worktrees under `.worktree/*`.
  2. For each, resolve the branch and query `gh pr view <branch> --json
     state,number` to find the PR.
  3. Build a removal list of worktrees whose PR is `MERGED` (not `CLOSED`,
     not `OPEN`).
  4. Print the list and prompt for confirmation. On `y`, remove each via
     `git worktree remove <path>` and delete the local branch with
     `git branch -d <branch>`.
- Never remove a worktree with uncommitted or unpushed changes. If
  `git status --porcelain` or `git log @{u}..` is non-empty, skip with a
  warning even if the PR is merged.
- A `--dry-run` flag prints what would be removed and exits.

## Tasks

- [ ] Wire the command into the existing CLI registry.
- [ ] Implement the enumeration, PR lookup, dirty-check, prompt, and removal
  steps.

## Acceptance criteria

- After merging a PR on GitHub, `jarvis cleanup --dry-run` lists exactly that
  worktree.
- `jarvis cleanup` (confirmed) removes it and deletes the local branch; the
  `.worktree/.keep` file is untouched.
- A worktree with uncommitted changes is never removed, even if its PR is
  merged.

## Docs

- Add a `jarvis cleanup` entry to the CLI section of the README.
