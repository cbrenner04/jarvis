# Materialized `node_modules` symlink is not rogue intent output

## Problem

`ensureExternalWorktree` symlinks `node_modules` at the worktree root when the project has one (`v2/src/execution/external-worktree.ts:181`). On a target repo whose `main` does not gitignore `node_modules`, that symlink appears in `git status --short --untracked-files=all`, so `findIntentLandingRoguePaths` (`v2/src/execution/intent-output.ts:162`) reports it as splitter output written outside `.jarvis-intent-stage/` and the run settles a non-repromptable `landing_failed` even though the staged ready-intents are valid.

## Decisions

- The recognition predicate lives beside the symlink creation in `v2/src/execution/external-worktree.ts` and is exported as `isMaterializedNodeModulesPath(worktreePath, path)` — rules out each consuming seam re-deriving its own `lstat` check and drifting apart.
- Recognition requires both the exact worktree-root path `node_modules` and `lstat` reporting a symbolic link — rules out whitelisting a real `node_modules` directory an agent committed.
- The exclusion is exact-path only: nested `packages/*/node_modules` and every other untracked root path stay rogue — rules out a name-based blanket ignore of untracked output.
- Classification never consults the target repo's `.gitignore` — rules out requiring every target project to ignore `node_modules`.

## Tasks

- [x] Export `MATERIALIZED_NODE_MODULES_PATH` and `isMaterializedNodeModulesPath(worktreePath, path)` from `v2/src/execution/external-worktree.ts`, guarded as `if (path !== MATERIALIZED_NODE_MODULES_PATH) return false;` followed by the `lstatSync(...)?.isSymbolicLink() === true` return.
- [x] In `findIntentLandingRoguePaths`, drop the path from rogue classification with `if (isMaterializedNodeModulesPath(input.worktreePath, path)) return false;`.
- [x] Add the three pinning tests below to `v2/src/execution/intent-output.test.ts` against a real git fixture with no `.gitignore` and a worktree-root `node_modules` symlink, each carrying its `// @mutate` directive inside the test body:
  - `// @mutate v2/src/execution/intent-output.ts "if (isMaterializedNodeModulesPath(input.worktreePath, path)) return false;" -> "if (false) return false;"`
  - `// @mutate v2/src/execution/external-worktree.ts "return lstatSync(join(worktreePath, MATERIALIZED_NODE_MODULES_PATH), { throwIfNoEntry: false })?.isSymbolicLink() === true;" -> "return true;"`
  - `// @mutate v2/src/execution/external-worktree.ts "if (path !== MATERIALIZED_NODE_MODULES_PATH) return false;" -> "if (false) return false;"`
  - Each quoted original must occur exactly once in its named file; adjust the anchor (not the behavior) if the implementation shape differs.
- [x] Update the docs listed below.

## Acceptance criteria

- [x] `v2/src/execution/intent-output.test.ts` test `landing with a harness-created node_modules symlink reports no rogue path` seeds an un-ignored worktree-root `node_modules` symlink alongside a valid `.jarvis-intent-stage/`, asserts `findIntentLandingRoguePaths` returns no path and `landIntentWorkflowOutput` lands the staged intent under the durable directory; it fails against the pre-fix classification and contains the headline-revert `// @mutate` directive. `v2/src/execution/intent-output.test.ts` — `landing with a harness-created node_modules symlink reports no rogue path`; Keystone checkpoint:
- [x] `v2/src/execution/intent-output.test.ts` test `an untracked real node_modules directory is still rogue intent output` proves the exclusion is scoped to the symlink: with a real untracked `node_modules` directory at the worktree root, landing still reports it rogue; its source directive inverts the symlink-only guard and makes the scoped test red. `v2/src/execution/intent-output.test.ts` — `an untracked real node_modules directory is still rogue intent output`; Mutation checkpoint:
- [x] `v2/src/execution/intent-output.test.ts` test `a different untracked worktree-root path is still rogue intent output` proves an unrelated untracked root file is still reported rogue while the symlink is present; its source directive inverts the path-equality guard and makes the scoped test red. `v2/src/execution/intent-output.test.ts` — `a different untracked worktree-root path is still rogue intent output`; Mutation checkpoint:
- [x] `v2/docs/workflow-runner.md` states that the materialization-created worktree-root `node_modules` symlink is never classified as rogue intent/plan splitter output, regardless of the target project's `.gitignore`.
- [x] `v2/docs/v1-behaviors.md` records the changed landing classification against the parity baseline.

## Documentation updates

- `v2/docs/workflow-runner.md` — replace the trailing "This addresses only the no-`node_modules` case of issue #2954…" sentence of the worktree-materialization paragraph with the new invariant: the symlink is a harness artifact, never agent output, and never rogue.
- `v2/docs/v1-behaviors.md` — extend the existing v2 `node_modules` symlink bullet with the landing-classification behavior.
