# 03 - Dotfile symlinks into worktree

## Problem

A fresh worktree is a clean checkout of tracked files only. Anything ignored
(currently just `node_modules/`, `*.log`, `.DS_Store`, `dist/`) does not appear
there, which can force redundant installs or break local-only configuration as
the repo grows.

## Decisions

- Provide a configurable symlink list. Default is empty, since the repo today
  has no untracked dotfiles worth linking.
- Source: a `worktreeSymlinks: string[]` field in the existing Jarvis config
  file (relative paths from repo root). Missing sources are skipped silently.
- Always symlink (never copy) so edits in either checkout stay in sync.
- Recommend `node_modules` in docs as the first entry users will likely want
  once they hit reinstall pain.

## Tasks

- [ ] Extend config schema with `worktreeSymlinks?: string[]` (default `[]`).
- [ ] After `ensureWorktree`, iterate the list and create relative symlinks
  inside the worktree. Skip entries that already exist as symlinks pointing to
  the same target.
- [ ] Error (do not overwrite) if a target path exists as a non-symlink file
  or directory.

## Acceptance criteria

- With an empty list (default), no symlinks are created and the worktree is
  untouched beyond `git worktree add`.
- With `worktreeSymlinks: ["node_modules"]`, the worktree gets a symlink
  pointing to `<repo>/node_modules` and `bun run` works without reinstall.
- Re-running with the same config is a no-op.

## Docs

- Document the config field and the `node_modules` example.
