---
name: normalize-residual-worktree-state-on-agent-error
---

# Normalize residual worktree/branch state on agent-error

## Problem

When a patch run exits `agent-error (exit 3)`, residual worktree/branch state is
inconsistent, making the otherwise-supported resume bumpier:

- iter 0: orphan worktree + branch at base, no commits — collides with a fresh
  run unless manually `git worktree remove --force` + `git branch -D`; #520's
  un-tick/strip cleanup is a no-op here.
- iter ≥1: a `WIP: … (N/M criteria)` commit on a local branch, and/or a dirty
  worktree with uncommitted edits plus agent litter (stray `test_output.txt`).

## Direction

On `agent-error` exit, leave residual state in one of two clean shapes:
either a committed WIP branch or a clean no-op. Extend #520's re-run cleanup to
also retire the iter-0 orphan worktree+branch and clear agent litter, so a
subsequent `jarvis1 run <index.md>` resumes without manual cleanup or collision.

## Out of scope

- Resumability itself (already works).
- Retrying transient agent errors before agent-error.

## Prerequisites

- Patch cascade exits agent-error (exit 3) when an iteration result classifies as a non-quota, non-progress agent error
- A WIP commit (`WIP: … (N/M criteria)`) is created for partial progress on incomplete exits
- Re-run cleanup that un-ticks/strips prior partial state exists (#520)
