# 00 - Worktree directory scaffold

## Problem

Spec runs need a stable place to put worktrees that ships with every clone but
keeps the worktree contents out of source control.

## Decisions

- Worktrees live under `.worktree/<spec-name>/` at the repo root.
- The `.worktree/` directory itself is tracked via a `.keep` file so clones
  receive it.
- Everything inside `.worktree/` other than `.keep` is gitignored.

## Tasks

- [ ] Create `.worktree/.keep` (empty file).
- [ ] Add to `.gitignore`:
  ```gitignore
  .worktree/*
  !.worktree/.keep
  ```

## Acceptance criteria

- `git status` is clean after creating a worktree under `.worktree/foo/`.
- A fresh clone has `.worktree/` present and contains only `.keep`.

## Docs

- Mention the directory and ignore rules in the README section that the later
  subspecs add.
