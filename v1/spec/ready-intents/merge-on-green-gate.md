---
name: merge-on-green-gate
---

# Gated admin-merge that can't skip the green gate

## Problem

Landing a completed PR is a manual `gh pr ready` → `gh pr checks --watch` →
`gh pr merge --admin --squash` dance, ~10× per session. The load-bearing rule —
never admin-merge until CI is green and `bun run ready` passes — lives only in
operator habit and has been violated, poisoning `main`. Nothing in the harness
enforces it.

## Behavior

A jarvis invocation marks a completed PR ready, then admin-squash-merges it
**only after** CI checks pass green and the local `bun run ready` gate passes.
On a red check or a failing ready gate it refuses to merge and reports the
specific failing check/gate instead. The operator still reviews the diff before
invoking; this folds only the mechanical ready→wait-green→admin-merge.

Prefer folding into an existing command's flow over a new subcommand (north
star), per `v1/docs/operator-runbook.md`.

## Out of scope

- Replacing human diff review.
- Auto-merging without explicit operator invocation.
- Target input forms beyond the current PR/branch.

## Prerequisites

