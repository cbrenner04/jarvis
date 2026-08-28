# Repair fence and dirty-worktree listing ignore the materialized symlink

## Problem

Two write-loop seams mirror what a completion commit stages, and subspec 01 makes both diverge from it on a target repo that does not gitignore `node_modules`:

- `enumerateRepairCompletionCandidates` (`v2/src/execution/write-loop.ts:635`) enumerates "paths a ready-gate repair completion commit would stage" with its own `read-tree` + `add -A`, so it would list the symlink the committer now excludes and the repair fence could refuse over a path that can never be committed.
- `getUncommittedPaths` (`v2/src/execution/write-loop.ts:499`) feeds `shouldFailTerminalCompletionForDirtyWorktree`. Before subspec 01 the symlink was absorbed into the checkpoint commit; after it, an iteration that changes nothing else produces no commit and the leftover untracked symlink alone fails terminal completion with `Uncommitted changes: node_modules` — a new failure on exactly the repo class this spec exists for.

## Decisions

- The fence reuses `completionStageArgs` from `v2/src/execution/completion-commit.ts` instead of its own literal — rules out the two staging lists drifting on the next change to either.
- `getUncommittedPaths` filters the artifact at the single shared helper — rules out patching each of its call sites (terminal completion, publication, diagnostics) separately and missing one.
- The filter drops only the materialized symlink; every other untracked path still counts as uncommitted work — rules out weakening the fail-closed dirty check into a general untracked-path amnesty.

## Tasks

- [ ] In `enumerateRepairCompletionCandidates`, bind `const stageArgs = completionStageArgs(worktreePath);` and pass it to `runRepairFenceGit` in place of the literal `["add", "-A"]`.
- [ ] Append `.filter((path) => !isMaterializedNodeModulesPath(worktreePath, path));` to the `getUncommittedPaths` pipeline.
- [ ] Add the pinning tests below to `v2/src/execution/write-loop.test.ts` against a real git fixture with no `.gitignore` and a worktree-root `node_modules` symlink, each carrying its `// @mutate` directive inside the test body:
  - `// @mutate v2/src/execution/write-loop.ts "const stageArgs = completionStageArgs(worktreePath);" -> "const stageArgs = ['add', '-A'];"`
  - `// @mutate v2/src/execution/write-loop.ts ".filter((path) => !isMaterializedNodeModulesPath(worktreePath, path));" -> ".filter(() => true);"`
  - Each quoted original must occur exactly once in the file; adjust the anchor (not the behavior) if the implementation shape differs.
- [ ] Update the docs listed below.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` test `repair completion candidates omit the harness-materialized node_modules symlink` asserts `enumerateRepairCompletionCandidates` on a worktree that does not gitignore `node_modules` lists the changed source paths and not the root symlink; it fails against the pre-fix literal `add -A` enumeration and contains the headline-revert `// @mutate` directive. `v2/src/execution/write-loop.test.ts` — `repair completion candidates omit the harness-materialized node_modules symlink`; Keystone checkpoint:
- [x] `v2/src/execution/write-loop.test.ts` test `uncommitted paths omit the materialized node_modules symlink and keep other untracked work` asserts `getUncommittedPaths` drops the root symlink while still listing an unrelated untracked file, so `shouldFailTerminalCompletionForDirtyWorktree` stays false for a symlink-only worktree and true when real work is left behind; it fails against the pre-fix listing and its source directive inverts the filter guard, making the scoped test red. `v2/src/execution/write-loop.test.ts` — `uncommitted paths omit the materialized node_modules symlink and keep other untracked work`; Mutation checkpoint:
- [x] `v2/docs/workflow-runner.md` states that ready-gate repair candidate enumeration and the terminal-completion dirty check both ignore the materialization-created worktree-root `node_modules` symlink.
- [x] `v2/docs/v1-behaviors.md` records the changed dirty-worktree and repair-fence behavior against the parity baseline.

## Documentation updates

- `v2/docs/workflow-runner.md` — extend the ready-gate repair section and the materialization paragraph with the fence and dirty-check invariants.
- `v2/docs/v1-behaviors.md` — extend the same `node_modules` symlink bullet with the repair-fence and terminal-completion dirty-check behavior.
