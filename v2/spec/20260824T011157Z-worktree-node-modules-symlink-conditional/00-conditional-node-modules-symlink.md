# Conditional node_modules symlink at materialization

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`ensureExternalWorktree` in `v2/src/execution/external-worktree.ts` ends fresh materialization with an unconditional `symlinkSync(join(args.projectRoot, "node_modules"), join(worktreePath, "node_modules"), "dir")`. A project with no `node_modules` (observed on `cbrenner04/chess-mvp-yolo`, a fresh iOS/SwiftUI repo) therefore gets a dangling symlink at the worktree root that it never asked for, and on a project whose `main` does not gitignore `node_modules` that untracked entry poisons intent landing (issue #2954). Every workflow that materializes an external worktree — intent, plan, implement — is affected.

## Decision ledger

- Gate the `symlinkSync` call behind a positive-form check — `if (statSync(projectNodeModules, { throwIfNoEntry: false })?.isDirectory()) { symlinkSync(...) }` — wrapping the call rather than an early-return negative form, so the `@mutate` directives' `-> "true"`/`-> "false"` inversions have the intended effect. Hoist the project-root `node_modules` path into a local named `projectNodeModules`, shared by the guard and the `symlinkSync` call.
- `statSync(...).isDirectory()` and `existsSync(...)` agree on every input except one: an entry that exists and is **not** a directory (a regular file, or a live symlink to a file). Both report `false` for a missing or dangling path — `existsSync` follows symlinks, so a dangling `<projectRoot>/node_modules` is `false` under either predicate. `statSync(...).isDirectory()` is chosen because it also excludes the non-directory case; the fixture below exercises exactly that discriminating input.
- Decide at materialization time only; reused worktrees and `git: false` local paths stay unmutated as today. Rules out a repair pass that adds or removes symlinks on reuse.
- No install-command or JS-project detection. Rules out inferring project type instead of observing `node_modules`.
- The absence assertion in tests uses `lstatSync(..., { throwIfNoEntry: false })`/`readdirSync` on the worktree root, not `existsSync`. Rules out an inert keystone: `existsSync` follows the link and reports `false` for the dangling baseline symlink, so it cannot distinguish fixed from pre-fix.
- `setupMockRepo`'s change to support a `node_modules`-free project is additive: an opt-in parameter, defaulting to today's behavior (creates `node_modules`), so the ~19 existing call sites in `external-worktree.test.ts` are unaffected.
- This change removes only the no-`node_modules` instance of the untracked worktree-root symlink from issue #2954. A JS project that does have `node_modules` and whose `main` doesn't gitignore it still gets an untracked symlink at the worktree root — gitignore-awareness or exclude-file handling for that symlink is separate behavior, out of scope here.
- `throwIfNoEntry: false` suppresses only `ENOENT` on the stat call; the guard does not otherwise change materialization or error handling. A permission error or symlink loop on the project root's `node_modules` now surfaces as a `statSync` failure during materialization, where the pre-fix unconditional `symlinkSync` (which never stats its source) would not have hit that failure mode.

## Prerequisites

- `ensureExternalWorktree` symlinks `node_modules` into fresh git-enabled worktrees before returning (`v2/src/execution/external-worktree.ts`).
- `v2/src/execution/external-worktree.test.ts` drives materialization through a fake git runner whose `worktree add` handler creates the worktree directory.

## Tasks

- Wrap the fresh-worktree `node_modules` symlink in `v2/src/execution/external-worktree.ts` in a positive-form directory check — `statSync(projectNodeModules, { throwIfNoEntry: false })?.isDirectory()` — around the existing `symlinkSync` call, hoisting the source path into a local named `projectNodeModules` shared by the guard and the call.
- Add an opt-in option to `setupMockRepo` in `v2/src/execution/external-worktree.test.ts` to build a repo without `node_modules` (existing call sites unaffected), and add: the absent-dependencies regression, a fixture where `<projectRoot>/node_modules` exists as a regular file (not a directory) asserting the worktree root still gets no `node_modules` entry, and the keystone/guard directives.
- Apply the Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/execution/external-worktree.test.ts` — `a project without node_modules leaves the fresh worktree root free of it` materializes a fresh worktree for a project root with no `node_modules`, asserts the worktree root has no `node_modules` entry (checked without following symlinks), and fails against the pre-fix unconditional `symlinkSync`.
- [ ] `v2/src/execution/external-worktree.test.ts` — a new test materializes a fresh worktree for a project root whose `node_modules` exists as a regular file (not a directory), asserts the worktree root has no `node_modules` entry, and would fail if the guard used mere existence (`existsSync`) instead of a directory check.
- [ ] `v2/src/execution/external-worktree.test.ts` — `provisions project dependencies before the first callback` stays green: a project that has a `node_modules` directory still gets the symlink to it before the first write callback.
- [ ] `v2/src/execution/external-worktree.test.ts` — `a project without node_modules leaves the fresh worktree root free of it`; Keystone checkpoint: its test body carries `// @mutate v2/src/execution/external-worktree.ts "statSync(projectNodeModules, { throwIfNoEntry: false })?.isDirectory()" -> "true"`, restoring the baseline unconditional symlink, and the mutation turns that regression RED.
- [ ] `v2/src/execution/external-worktree.test.ts` — `provisions project dependencies before the first callback`; Mutation checkpoint: its test body carries `// @mutate v2/src/execution/external-worktree.ts "statSync(projectNodeModules, { throwIfNoEntry: false })?.isDirectory()" -> "false"`, inverting the guard so the symlink is suppressed for a project that does have `node_modules`, and the mutation turns that test RED.
- [ ] `v2/docs/workflow-runner.md` states that a fresh git-enabled external worktree receives the `node_modules` symlink only when the project root has a `node_modules` directory, that reused worktrees and `git: false` local paths are still not mutated, and that this does not address gitignore-awareness for projects that do have `node_modules`.
- [ ] `v2/docs/v1-behaviors.md` records this as v2 converging on v1's existing behavior of skipping a symlink whose source path is absent (`v1/src/worktree.ts`), and names the residual divergences: v2 gates on directory-ness where v1 gates on existence, and v2 hardcodes a single `node_modules` link with an absolute target where v1 walks a configurable list with relative targets.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § fresh external worktrees — the `node_modules` symlink is conditional on `<projectRoot>/node_modules` existing as a directory; a project without one gets a worktree root free of it, and gains the symlink on its next fresh materialization. Note this addresses only the no-`node_modules` case of issue #2954; a JS project with `node_modules` still gets an untracked symlink if its `main` doesn't gitignore it.
- `v2/docs/v1-behaviors.md` — alongside the catalog's existing `node_modules` symlink entry, record this as v2 converging on v1's existing behavior rather than diverging from it: `v1/src/worktree.ts` already skips symlinking any source path that doesn't exist, so v1 never produced the dangling link. Name the residual divergences that remain: v2 gates on directory-ness where v1 gates on existence, and v2 hardcodes a single `node_modules` link with an absolute target where v1 walks a configurable list with relative targets.
