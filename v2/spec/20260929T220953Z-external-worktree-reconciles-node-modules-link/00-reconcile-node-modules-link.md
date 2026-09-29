# Reconcile the external-worktree `node_modules` link

## Problem

Worktree materialization unconditionally creates the worktree-root `node_modules` symlink when the project dependency directory exists. A checked-out entry at that path therefore raises `EEXIST` before the callback, even when it is already the correct harness link. A collision refused during fresh materialization also leaves the worktree and branch already created and git-registered, so the next `withExternalWorktree` call for that branch takes the reuse path — which today returns without touching `node_modules` at all.

## Decisions

- Reconcile the `node_modules` destination on every `ensureExternalWorktree` return — both the fresh-creation path and the worktree-reuse path — rather than only after fresh checkout, and only while the project root's `node_modules` is a directory; rules out a worktree left permanently without a link after a refused collision is resolved out-of-band and retried, and rules out tearing down and re-creating the worktree/branch a refused fresh attempt already registered.
- Classify the destination via `lstat`; treat it as correct only when it is a symlink whose target resolves to the project root's `node_modules`, and as wrong-target otherwise, including a dangling symlink whose target does not exist; rules out an existence-based check that treats a dangling link as already correct and lets `symlinkSync` throw `EEXIST` on it — the exact failure this spec exists to fix.
- Replace only wrong-target (including dangling) symlinks; refuse every non-symlink collision without removing it and report the destination path, filesystem type, and expected target, ruling out destructive cleanup of tracked files, real directories, or special entries.
- Keep implementation support private to `external-worktree.ts`; rules out adding a test-only production export for destination classification or reconciliation.

## Task checklist

- [ ] Reconcile the `node_modules` destination before invoking the callback on both the fresh-creation return and the worktree-reuse return: preserve a correct symlink unchanged, replace a wrong-target or dangling symlink, and create the link when absent.
- [ ] Fail materialization on regular-file, real-directory, or other non-symlink collisions without deleting the entry, with actionable collision diagnostics, on both the fresh and reuse paths.
- [ ] Extend `v2/src/execution/external-worktree.test.ts` with checkout fixtures and assertions for correct-link reuse, wrong-target and dangling-link replacement, preserved file/directory collisions, and reuse-path reconciliation after a prior collision is resolved.
- [ ] Update `v2/docs/workflow-runner.md` with destination reconciliation (fresh and reuse) and non-symlink collision behavior.
- [ ] Update `v2/docs/operator-runbook.md` with recovery for a base branch that tracks `node_modules`, including a symlink-matching ignore rule rather than a directory-only trailing-slash rule.
- [ ] Update `v2/docs/v1-behaviors.md` with the changed v2 collision behavior and remaining v1 divergence.

## Acceptance criteria

- [ ] `v2/src/execution/external-worktree.test.ts` proves a fresh checkout whose `node_modules` is already a symlink resolving to the project root's `node_modules` reaches the callback and leaves the link's target and identity unchanged; this regression fails against the pre-fix unconditional `symlinkSync` with `EEXIST`.
- [ ] `v2/src/execution/external-worktree.test.ts` proves a fresh checkout's wrong-target `node_modules` symlink, and separately a dangling `node_modules` symlink (target does not exist), are each replaced with a link to the project root's `node_modules` before the callback.
- [ ] `v2/src/execution/external-worktree.test.ts` proves regular-file and real-directory collisions remain intact, the callback is not invoked, and `WorktreeMaterializationError` diagnostics name the link path, current type, and expected target.
- [ ] `v2/src/execution/external-worktree.test.ts` proves a registered worktree from a fresh attempt refused on a `node_modules` collision, once the collision is resolved out-of-band, has its link reconciled (created or corrected) by the next `withExternalWorktree` call for that branch via the reuse path, before the callback runs.
- [ ] `v2/src/execution/external-worktree.test.ts` tests `a project without node_modules leaves the fresh worktree root free of it`, `a project whose node_modules is a regular file leaves the fresh worktree root free of it`, and `provisions project dependencies before the first callback` stay green.
- [ ] `v2/docs/operator-runbook.md`, `v2/docs/workflow-runner.md`, and `v2/docs/v1-behaviors.md` document the recovery, reconciliation contract, and v2 behavior change without duplicating implementation detail.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — explain recovery when a base branch tracks `node_modules` and require an ignore pattern that matches the harness symlink.
- `v2/docs/workflow-runner.md` — define correct-link reuse, wrong-link replacement, preserved non-symlink collisions, and the existing source-directory guard.
- `v2/docs/v1-behaviors.md` — record the changed v2 fresh-materialization collision behavior and its v1 comparison.
