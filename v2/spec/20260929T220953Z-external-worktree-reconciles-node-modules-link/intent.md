---
name: external-worktree-reconciles-node-modules-link
---

# External worktree materialization reconciles the `node_modules` link

## Problem

Fresh materialization unconditionally creates the worktree-root `node_modules` symlink after checkout. If the base tree already contains that path, `symlinkSync` throws `EEXIST` before routing or agent invocation, including when the existing entry is the correct harness-created link committed by an earlier lane.

## Behavior

- If the checked-out path is already a symlink to the project root's `node_modules`, accept it unchanged.
- If it is a symlink to another target, replace it with the correct link.
- If it is a regular file, real directory, or another non-symlink entry, fail materialization without deleting it; the error names the link path, its current type, and the expected target.
- Keep the existing source guard: create or reconcile the link only when the project root's `node_modules` is a directory.

## Acceptance criteria

- [ ] `v2/src/execution/external-worktree.test.ts` proves a fresh checkout that already contains the correct `node_modules` symlink reaches the callback; the regression fails against the pre-fix unconditional `symlinkSync` with `EEXIST`.
- [ ] `v2/src/execution/external-worktree.test.ts` proves a wrong-target symlink is replaced with the project root's `node_modules` target.
- [ ] `v2/src/execution/external-worktree.test.ts` proves regular-file and real-directory collisions are preserved and fail with diagnostics naming the link path, current type, and expected target.
- [ ] `v2/src/execution/external-worktree.test.ts` tests `a project without node_modules leaves the fresh worktree root free of it`, `a project whose node_modules is a regular file leaves the fresh worktree root free of it`, and `provisions project dependencies before the first callback` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — recovery when a base branch already tracks `node_modules`, including the required ignore rule for a symlink.
- `v2/docs/workflow-runner.md` — destination reconciliation and collision behavior for the harness-owned link.
- `v2/docs/v1-behaviors.md` — record the changed v2 materialization collision behavior.

## Prerequisites
