---
name: intent-landing-never-treats-node-modules-symlink-as-rogue
---

# A Harness-Created `node_modules` Symlink Is Never Rogue Intent Output

## Prerequisites

- External worktree materialization creates the root `node_modules` symlink only when the registered project has a `node_modules` directory.
- Intent landing lists untracked worktree paths (`git status --short --untracked-files=all`) and refuses paths outside the configured stage directory as rogue splitter output.
- The settled-iteration checkpoint commit stages the whole worktree, so any untracked root entry enters the intent branch.

## Surface

Execution loop — intent/plan landing validation and the settled-iteration checkpoint commit (`v2/src/execution/intent-output.ts`, `v2/src/execution/write-loop.ts`).

## Problem

- On a target repo whose `main` does not gitignore `node_modules`, the harness-created worktree symlink shows up in `git status --untracked-files=all` as a path outside `.jarvis-intent-stage/`, so `findIntentLandingRoguePaths` reports rogue splitter output and the run settles a non-repromptable `landing_failed` even though the agent staged valid ready-intents.
- The checkpoint commit then captures the symlink (`node_modules | 1 +`), so the intent branch carries it through plan → implement → merge on a plain `pipeline resume`.
- Making the symlink conditional fixes the reported no-`node_modules` case but not a JS project that simply never gitignored `node_modules`; the harness must not treat its own materialization artifact as agent output.

## Behavior

- Intent and plan landing ignore a harness-created `node_modules` symlink at the worktree root when classifying rogue paths, so landing succeeds with only stage-directory paths staged, regardless of the target project's `.gitignore`.
- The checkpoint/landing commit for an intent stage never contains that symlink.
- Any other untracked worktree-root path stays rogue; the exclusion is scoped to the materialization artifact, not to untracked output generally.

## Decisions

- Recognize the artifact by the harness's own materialization convention (root-level `node_modules` that is a symlink), not by path name alone — rules out whitelisting a real `node_modules` directory an agent committed.
- Exclude it at both the rogue-path classification seam and the commit-staging seam — rules out fixing only the gate and still poisoning the branch, and only the commit and still failing the gate.
- Do not depend on the target repo's `.gitignore` — rules out requiring every target project to ignore `node_modules`.

## Required verification

- A test seeds an un-ignored worktree-root `node_modules` symlink alongside a valid `.jarvis-intent-stage/` and asserts landing reports no rogue path; it fails against the pre-fix classification.
- A test asserts the committed tree for that landing omits `node_modules` while containing the staged intent files.
- A test asserts a different untracked worktree-root path is still classified rogue.

## Documentation updates

- `v2/docs/workflow-runner.md` — the materialization-created `node_modules` symlink is never rogue intent/plan output and never enters the checkpoint commit.
- `v2/docs/v1-behaviors.md` — record the changed landing/commit behavior against the parity baseline.
