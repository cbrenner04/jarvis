---
name: worktree-branches-off-fresh-base
description: New worktree branches start from the latest fetched base, not a stale local base ref
---

# Worktree branches off fresh base

When a jarvis command (`run`, `plan`, `intent`) creates a new branch+worktree, the
branch must start from the up-to-date base — the just-fetched remote base ref
(e.g. `origin/main`) — not the possibly-stale local base branch ref.

Today `bestEffortFetch` updates `origin/main` but the branch is then cut from the
local base name, so a stale local `main` produces a worktree behind the real base.
Cutting from the fetched remote ref keeps fresh-checkout work from starting behind.

Observable behavior: a new worktree created while the local base ref is behind
origin starts at origin's base tip, not the stale local commit. When the fetch
fails (offline/no origin), creation still proceeds best-effort off the local base.

## Prerequisites
