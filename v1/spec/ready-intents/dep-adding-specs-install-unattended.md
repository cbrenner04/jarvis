---
name: dep-adding-specs-install-unattended
---

# Dep-adding specs install npm deps unattended

## Behavior

A spec that adds an npm dependency runs to completion without an operator
hand-installing out-of-sandbox. Today the worktree symlinks `node_modules` to
the primary checkout (outside the writable worktree root), so both actuators
fail: codex `bun add` hits `FailedToOpenSocket` (network blocked) + an empty
workspace-local cache; claude `bun install` hits `EPERM` writing through the
symlink. Make Jarvis resolve the install itself for dependency-touching
worktrees, while preserving the cheap `node_modules` symlink for specs that do
not touch deps.

Plan weighs the mechanism (not separate intents — one of these, or a
combination):
- Harness-side install: after an iteration changes `package.json`/lockfile,
  Jarvis runs `bun install` outside the agent sandbox.
- Real per-worktree `node_modules` (copied or freshly installed) the agent can
  write, instead of the symlink, when the spec touches deps.
- Per-run symlink opt-out flag/heuristic that skips the `node_modules` symlink
  for dep-adding specs.

## Out of scope

- Changing the default symlink optimization for non-dep specs.

## Prerequisites
