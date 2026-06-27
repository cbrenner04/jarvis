---
name: patch-completion-commit-tolerates-self-committed-tree
---

# Per-subspec completion commit tolerates an already-committed (clean) tree

## Problem

When the patch agent self-commits its subspec changes, jarvis's per-subspec
completion commit runs `git add -A` then `git commit -F -` against a clean tree
and git exits non-zero with `nothing to commit, working tree clean`. Jarvis
treats that throw as fatal and aborts the whole run (exit 1), so later subspecs
never execute and multi-subspec specs land partially. Intake #547.

## Behavior

When the per-subspec completion commit finds nothing staged to commit, do not
abort: detect that the subspec's changes are already committed (agent
self-committed) and continue to the next subspec instead of throwing. Genuine
`git commit` failures (anything other than the empty/clean-tree case) still
surface as errors. A real commit (dirty tree) is committed exactly as today.

The clean-tree guard already exists for the blocker WIP commit path
(`git diff --cached --quiet` early-return); apply the same tolerance to the
completion commit and the non-blocker WIP progress commit so a self-committing
agent never loses the run on any per-subspec commit.

## Out of scope

- Changing the agent's commit behavior (separate, optional intent).

## Prerequisites
