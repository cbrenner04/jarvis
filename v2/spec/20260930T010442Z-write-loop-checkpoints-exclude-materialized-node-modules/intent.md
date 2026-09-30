---
name: write-loop-checkpoints-exclude-materialized-node-modules
---

# Write-loop checkpoints never commit materialized `node_modules`

## Problem

The shared completion committer excludes a materialized worktree-root `node_modules` symlink, but no write-loop regression proves settled-iteration checkpoints retain that exclusion. With a target `.gitignore` containing only `node_modules/`, a bare `git add -A` stages the symlink and can poison the base branch for every later lane.

## Behavior

- Every settled-iteration checkpoint commit uses the shared completion-staging exclusion and omits an untracked harness-materialized worktree-root `node_modules` symlink regardless of the target repository's ignore rules.
- The exclusion remains narrow: checkpoint commits still include ordinary authored changes and do not delete a `node_modules` entry already tracked at `HEAD`.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` drives a real settled iteration through the production checkpoint committer with `.gitignore` containing only `node_modules/`, a materialized root symlink, and an authored change; the resulting commit contains the authored change and no new `node_modules` path, and fails against checkpoint staging changed to bare `git add -A`.
- [ ] `v2/src/execution/completion-commit.test.ts` tests `a real untracked node_modules directory is still committed` and `a node_modules symlink already tracked at HEAD survives the completion commit` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — state explicitly that settled-iteration checkpoint commits inherit the harness-owned `node_modules` exclusion.
- `v2/docs/v1-behaviors.md` — record the checkpoint-staging behavior against the parity baseline.

## Prerequisites

- Fresh external-worktree materialization accepts a correct existing worktree-root `node_modules` symlink, replaces a wrong-target symlink, and rejects non-symlink collisions with actionable diagnostics.
