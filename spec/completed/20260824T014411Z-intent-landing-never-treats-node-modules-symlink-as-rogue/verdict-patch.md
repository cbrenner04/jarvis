## Verdict — 4 required outcomes

### 1. A reused worktree holding only the materialized symlink must not block re-dispatch (regression, must fix in-branch)

`listDirtyWorktreePathsForStaleReset` (`v2/src/commands/cleanup.ts:1602`) parses its own `git status --porcelain --untracked-files=all` and skips only `.jarvis-*` sidecar paths. It is a second dirty-worktree listing seam, independent of `getUncommittedPaths`. Its refusal propagates through `resetStaleWorkspace` → `maybeResetStaleWorkspace` (`v2/src/commands/stale-reset-workspace.ts:62-68`) and fails the run with `Cannot re-run incomplete spec: worktree has uncommitted changes (node_modules)`, and it only fires when the worktree already exists — i.e. exactly the intent/plan/implement re-dispatch this spec exists to unblock.

Before this branch, the symlink was absorbed into the settled-iteration checkpoint commit, so the worktree came back clean. Subspec 01 stops committing it, so on a target repo that does not gitignore `node_modules` the symlink now survives every iteration and this gate refuses. That is a new failure the branch introduces, on the spec's own target repo class.

Required outcome: on a worktree whose only uncommitted entry is the harness-materialized root `node_modules` symlink, stale reset proceeds rather than refusing; any other untracked or modified path still refuses exactly as today. Recognition must go through the same shared `isMaterializedNodeModulesPath` predicate the other seams use — subspec 02's decision was explicitly "filter at the single shared helper … rules out patching each call site and missing one", and this is the call site that was missed. Pin it with a test carrying a `// @mutate` directive on the new guard, in the convention the branch's other tests already follow, and record the invariant in the durable doc home alongside the existing landing/commit/fence/dirty-check invariants.

### 2. The completion-commit exclusion must not carry a dead pattern or a comment that contradicts the code

`EXCLUDE_MATERIALIZED_NODE_MODULES` (`v2/src/execution/completion-commit.ts:245-260`) is appended only when the worktree path *is* a symlink, and git never descends a symlink — so the `:(exclude)…/**` element can never match. Worse, the accompanying comment justifies it as covering "its contents (a real directory)", which is the case the guard deliberately excludes and which `a real untracked node_modules directory is still committed` pins as *stageable*. If the pattern ever did fire (symlink swapped for a directory between the `lstat` and the `add`), it would suppress work the test contract says must be committed.

Required outcome: only the pattern that can actually match remains, and the surviving comment describes what the code does. The rationale for the `node_module[s]` character-class glob (avoiding the "paths are ignored" hard failure on repos that *do* gitignore `node_modules`) is well earned — keep it.

### 3. Comments on the two changed write-loop seams must match the changed behavior

- `enumerateRepairCompletionCandidates` (`v2/src/execution/write-loop.ts:645`) still documents itself as "`read-tree` + `add -A`" when the entire point of the change is that it no longer stages with a literal `add -A`.
- An orphaned `/** git status --porcelain paths; fail-soft to [] — diagnostic listing only. */` sits at `v2/src/execution/write-loop.ts:498`, stacked above `shouldFailTerminalCompletionForDirtyWorktree` but written for `getUncommittedPaths`. The misplacement predates the branch; the branch makes "diagnostic listing only" doubly wrong, since that listing feeds a fail-closed terminal-completion gate and now also filters.

Required outcome: both docblocks accurately describe the functions they sit on, including the new filtering/pathspec behavior.

### 4. The `v1-behaviors.md` bullet must come back under the terseness rule

The `node_modules` symlink bullet grew to roughly 1600 characters because three subspecs each said "extend the same bullet". Required outcome: it states the invariants (never staged by a completion commit, never `rm --cached` an already-tracked entry, repair-fence enumeration shares the same pathspec, dirty checks — including stale reset — filter the symlink) and leaves mechanism detail to `workflow-runner.md`, without losing anything the acceptance criteria require it to record.

---

**Explicitly not required** (do not expand into these):

- `review-intent-enforcement.ts`'s unauthorized-path check and `git clean -fd` do see the symlink, but that fires today independent of this branch and sits outside all three subspecs' surfaces. Follow-up intent, not in-branch.
- The "never deleted" doc clause is correctly scoped to the mechanism choice (`add -A` pathspec vs `git rm --cached`) and matches the acceptance criterion's wording. No change.
- `add -A` → `add -A -- .` narrows to cwd, but completion commits only run at materialized worktree roots. No change.
- Subspec 00's stale `## Blocker` (unrelated `sandbox-unrunnable` integration flakes) and its unchecked `index.md` box despite complete, landed work are an operator finalize item — `index.md` is Jarvis-owned and must not be edited by the actuator.