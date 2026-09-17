---
name: worktree-materialization-fails-on-committed-node-modules-symlink
---

# Worktree materialization dies `EEXIST` on a `node_modules` symlink the harness itself committed

## Problem

`ensureExternalWorktree` (`v2/src/execution/external-worktree.ts:248-251`) guards its `node_modules` symlink on the **source** only:

```ts
const projectNodeModules = join(args.projectRoot, MATERIALIZED_NODE_MODULES_PATH);
if (statSync(projectNodeModules, { throwIfNoEntry: false })?.isDirectory()) {
  symlinkSync(projectNodeModules, join(worktreePath, MATERIALIZED_NODE_MODULES_PATH), "dir");
}
```

It never `lstat`s the **link path**. When `git worktree add` checks out a base tree that already contains a `node_modules` entry, `symlinkSync` throws `EEXIST` and the whole materialization fails as `worktree_materialization_failed` — before any run row, routing read, or agent invocation.

**The harness manufactures that base tree itself.** The materialized `node_modules` is a symlink, and the ubiquitous `.gitignore` rule `node_modules/` (trailing slash) matches directories, not symlinks — so a boundary or landing `git add -A` stages and commits it. Once that lands on a base branch, every subsequent lane branching from that base dies at materialization. Recovery required editing the *target* repo (`git rm --cached node_modules`, then a bare `node_modules` ignore line); no harness verb clears it.

The completed spec `20260824T011157Z-worktree-node-modules-symlink-conditional` added exactly the source-only guard that is now the bug — it explicitly scoped out the case of a project that already has a `node_modules` entry. `20260824T014411Z-intent-landing-never-treats-node-modules-symlink-as-rogue` covered the *intent* landing path, not implement boundary/landing commits.

## Evidence

Issue #4003. Every re-run off base `TESTENG_144_Baseline_and_Diagnostics` reproduced identically after PR #92 merged the symlink onto that base. Mechanism re-verified on `main` 2026-09-17: `external-worktree.ts:248-251` is still the unguarded `symlinkSync`.

Base-poisoning, so the blast radius is every lane on the branch, not one run.

## Decisions

- Materialization is idempotent at the link path: an existing correct symlink is accepted, a wrong-target symlink is replaced, and only a non-symlink entry is an error; rules out `EEXIST` from re-materializing over a tree that already carries the entry.
- The harness never commits its own materialized `node_modules` symlink: the boundary/landing add path excludes it regardless of whether the project's ignore rule matches a symlink; rules out the harness poisoning a base branch for every later lane.
- A materialization failure at the symlink step names the link path, its current type, and the expected target; rules out an opaque `EEXIST` an operator must read the source to diagnose.

## Acceptance criteria

- [ ] An `external-worktree` test proves materialization succeeds when the checked-out base tree already contains a `node_modules` symlink pointing at the project's `node_modules`; it fails against the current unconditional `symlinkSync` with `EEXIST`.
- [ ] A test proves a `node_modules` symlink pointing somewhere else is replaced with the correct target, and a `node_modules` entry that is a regular file or real directory fails with a message naming the link path and its type.
- [ ] A write-loop (or landing) test proves a boundary commit over a worktree carrying the materialized `node_modules` symlink stages no `node_modules` path, with an ignore file whose only rule is `node_modules/`; it fails against the current `git add -A` behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the materialized `node_modules` symlink is harness-owned and never committed.
- `v2/docs/operator-runbook.md` — recovery when a base branch already carries a committed `node_modules` entry.
