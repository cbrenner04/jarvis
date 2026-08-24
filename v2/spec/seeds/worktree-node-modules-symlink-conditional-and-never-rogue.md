---
name: worktree-node-modules-symlink-conditional-and-never-rogue
---

# Unconditional node_modules worktree symlink poisons non-JS projects and fails intent landing with no cause

## Problem

`createExternalWorktree` (`v2/src/execution/external-worktree.ts:181`) unconditionally runs `symlinkSync(join(projectRoot, "node_modules"), join(worktreePath, "node_modules"), "dir")` on every fresh worktree, even when the project has no `node_modules` (a dangling symlink) and is not a JS project. When the target project's `main` does not gitignore `node_modules`, the intent-landing rogue-path check (`findIntentLandingRoguePaths` / `listWorktreeChangedPaths` via `git status --short --untracked-files=all`, `v2/src/execution/intent-output.ts`) sees the untracked symlink as a path outside `.jarvis-intent-stage/` and settles a non-repromptable `landing_failed` — even though the agent staged valid ready-intents. The checkpoint commit then captures the symlink (`node_modules | 1 +`), poisoning the intent branch so a plain `pipeline resume` would carry it through plan → implement → merge. Plan and implement materialize worktrees the same way and hit the same wall; not `fast`-specific.

The failure carries no cause: `failureDetail: { reason: "landing_failed", retryable: true, nextAction: "resume" }`, and `jarvis run log` shows only `iteration_commit`/`boundary_committed`/`loop_finished`; diagnosis required `git show --stat HEAD` by hand. Reported from `cbrenner04/chess-mvp-yolo` (fresh iOS/SwiftUI repo, no `node_modules`, no `.gitignore`), pipeline `0ebe64c7`, GitHub issue #2954.

## Decisions

- Create the `node_modules` symlink only when `<projectRoot>/node_modules` exists as a directory — rules out the dangling symlink on non-JS/no-deps projects (the primary fix). A project that later adds `node_modules` gets the symlink on its next worktree materialization.
- Treat a harness-created worktree `node_modules` symlink as never-rogue: exclude it from intent/plan rogue-path detection and from checkpoint commits regardless of the target project's `.gitignore` — defense in depth so a JS project without a `node_modules` gitignore entry is not poisoned either. Rules out relying on every target repo to gitignore `node_modules`.
- Persist the cause on a non-repromptable `landing_failed`: put a `message` on the stage `failureDetail` and in the run log naming the violation class and offending path(s) (e.g. `rogue path outside .jarvis-intent-stage/: node_modules`) — rules out the current cause-less `{ reason: "landing_failed" }` that forced a hand `git show`. This generalizes to any rogue-path landing failure, not only the symlink case.
- Out of scope (note only): a `jarvis init` readiness row warning when the project does not ignore `node_modules`.

## Acceptance criteria

- [ ] `createExternalWorktree` creates the `node_modules` symlink only when `<projectRoot>/node_modules` exists as a directory, and creates no symlink otherwise — pinned by a test materializing a worktree in a project with and without `node_modules`.
- [ ] Intent (and plan) rogue-path detection excludes a materialization-created `node_modules` symlink at the worktree root even when the target project does not gitignore it, so landing succeeds with only `.jarvis-intent-stage/` staged — pinned by a test seeding an un-ignored `node_modules` symlink and asserting no rogue-path failure.
- [ ] The checkpoint/landing commit for an intent stage never includes the `node_modules` symlink — pinned by a test asserting the committed tree omits it.
- [ ] A non-repromptable `landing_failed` carries a `failureDetail.message` (and a run-log record) naming the violation class and offending path(s) — pinned by a test over the rogue-path failure path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/` (external-worktree / intent-landing reference, wherever materialization is documented) — the `node_modules` symlink is conditional on the project having `node_modules`, is never treated as rogue output, and `landing_failed` now names its cause. Closes #2954.
