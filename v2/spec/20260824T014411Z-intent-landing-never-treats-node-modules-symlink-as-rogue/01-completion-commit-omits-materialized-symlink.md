# Completion commits never stage the materialized symlink

## Problem

`preparePendingCommit` snapshots the worktree with `read-tree HEAD` + `git add -A` into a temp index (`v2/src/execution/completion-commit.ts:272`). On a target repo that does not gitignore `node_modules`, the harness-created worktree-root symlink enters that snapshot, so the settled-iteration checkpoint commit carries `node_modules | 1 +` and the intent branch propagates it through plan → implement → merge. Fixing only the rogue-path gate (subspec 00) leaves this branch poisoning intact.

## Decisions

- Exclude the artifact by narrowing the `add -A` pathspec rather than un-staging it afterwards — rules out `git rm --cached`, which would also delete a `node_modules` entry already tracked at `HEAD` and turn a poisoned repo's next commit into a deletion the operator did not ask for.
- The exclusion is unconditional across every harness completion commit, not gated on the intent step — rules out threading a step-kind flag through the committer for an artifact that is never legitimate agent output in any step.
- `completionStageArgs(worktreePath)` is exported from `v2/src/execution/completion-commit.ts` — the ready-gate repair fence (subspec 02) must stage exactly what the committer stages, so the argument list is one shared source.

## Tasks

- [ ] In `v2/src/execution/completion-commit.ts` add module constants `ADD_ALL_ARGS` (`["add", "-A"]`) and `EXCLUDE_MATERIALIZED_NODE_MODULES` (the `--`/`.`/`:(exclude)node_modules` pathspec triple), plus exported `completionStageArgs(worktreePath)` shaped as `if (!isMaterializedNodeModulesPath(worktreePath, MATERIALIZED_NODE_MODULES_PATH)) return [...ADD_ALL_ARGS];` followed by `return [...ADD_ALL_ARGS, ...EXCLUDE_MATERIALIZED_NODE_MODULES];`.
- [ ] Call it from `preparePendingCommit` in place of the literal `["add", "-A"]`.
- [ ] Add the pinning tests below to `v2/src/execution/completion-commit.test.ts` using a real git fixture that does **not** copy `.gitignore` (the existing `initRealGitWorktree` helper ignores `node_modules`), each carrying its `// @mutate` directive inside the test body:
  - `// @mutate v2/src/execution/completion-commit.ts "return [...ADD_ALL_ARGS, ...EXCLUDE_MATERIALIZED_NODE_MODULES];" -> "return [...ADD_ALL_ARGS];"`
  - `// @mutate v2/src/execution/completion-commit.ts "if (!isMaterializedNodeModulesPath(worktreePath, MATERIALIZED_NODE_MODULES_PATH)) return [...ADD_ALL_ARGS];" -> "if (false) return [...ADD_ALL_ARGS];"`
  - Each quoted original must occur exactly once in the file; adjust the anchor (not the behavior) if the implementation shape differs.
- [ ] Update the docs listed below.

## Acceptance criteria

- [x] `v2/src/execution/completion-commit.test.ts` test `completion commit omits the harness-materialized node_modules symlink` commits a real git worktree that does not gitignore `node_modules`, with the root symlink present alongside changed staged files, and asserts the committed tree contains those files and no `node_modules` entry; it fails against the pre-fix `add -A` staging and contains the headline-revert `// @mutate` directive. `v2/src/execution/completion-commit.test.ts` — `completion commit omits the harness-materialized node_modules symlink`; Keystone checkpoint:
- [x] `v2/src/execution/completion-commit.test.ts` test `a real untracked node_modules directory is still committed` proves the exclusion suppresses nothing beyond the symlink: a real untracked `node_modules/` directory still reaches the committed tree; its source directive inverts the symlink-only staging guard and makes the scoped test red. `v2/src/execution/completion-commit.test.ts` — `a real untracked node_modules directory is still committed`; Mutation checkpoint:
- [x] `v2/src/execution/completion-commit.test.ts` test `a node_modules symlink already tracked at HEAD survives the completion commit` proves the narrowed pathspec deletes nothing: a repo whose `HEAD` already tracks the symlink keeps that entry in the next completion tree.
- [x] `v2/docs/workflow-runner.md` states that harness completion commits never stage the materialization-created worktree-root `node_modules` symlink and never delete a `node_modules` entry already tracked at `HEAD`.
- [x] `v2/docs/v1-behaviors.md` records the changed completion-commit staging against the parity baseline.

## Documentation updates

- `v2/docs/workflow-runner.md` — add the commit-staging invariant beside the worktree-materialization paragraph updated in subspec 00.
- `v2/docs/v1-behaviors.md` — extend the same `node_modules` symlink bullet with the completion-commit staging behavior.
