---
name: worktree-node-modules-symlink-conditional
---

# Fresh Worktrees Only Get A `node_modules` Symlink When The Project Has One

## Prerequisites

## Surface

Execution loop — external worktree materialization (`v2/src/execution/external-worktree.ts`).

## Problem

- `createExternalWorktree` unconditionally symlinks `<projectRoot>/node_modules` into every fresh external worktree, so a project without `node_modules` (observed on `cbrenner04/chess-mvp-yolo`, a fresh iOS/SwiftUI repo) gets a dangling symlink it never asked for.
- The dangling symlink is untracked worktree output that downstream gates and commits then have to reason about; on a project whose `main` does not gitignore `node_modules` it poisons intent landing outright (GitHub issue #2954).
- Every workflow that materializes an external worktree — intent, plan, implement — is affected; this is not `fast`-specific.

## Behavior

- Materializing a fresh external worktree creates the root `node_modules` symlink only when `<projectRoot>/node_modules` exists as a directory, and leaves the worktree root free of it otherwise.
- A project that later gains `node_modules` gets the symlink on its next worktree materialization; no migration of existing worktrees.

## Decisions

- Gate on `<projectRoot>/node_modules` existing as a directory, not on mere path existence — rules out re-linking a project root whose own `node_modules` is itself a stale symlink or file.
- Decide at materialization time only; reused worktrees stay unmutated as today — rules out a repair pass that adds or removes symlinks on reuse.
- No install-command or JS-project detection — rules out inferring project type instead of observing `node_modules`.

## Required verification

- A test materializes a worktree in a project with `node_modules` and one without, asserting the symlink is present in the first case and no `node_modules` entry exists at the worktree root in the second; it fails against the pre-fix unconditional `symlinkSync`.

## Documentation updates

- `v2/docs/workflow-runner.md` — the fresh-worktree `node_modules` symlink is conditional on the project having a `node_modules` directory.
- `v2/docs/v1-behaviors.md` — record the changed materialization behavior against the parity baseline.
