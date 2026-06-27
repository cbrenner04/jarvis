---
name: plan-block-should-not-open-mergeable-pr
---

# A blocked plan must not open a normal mergeable PR (no index.md)

## Problem

When a `jarvis plan` run blocks on an unmet prerequisite, it correctly writes only
the refined `intent.md` (with a `## Blocker`) and does **not** generate
`index.md`/subspecs — but it still opens a **normal, mergeable** draft PR. On
green CI (which doesn't run `lint:md` or check for an index), the operator merged
two such PRs (#644 failure-exits-cite, #645 runbook-add) blind, landing
"specs" with no `index.md`. The gap was only discovered at run time:
`spec path does not exist`, twice, after launching runs against them.

Observed 2026-06-27: both #598 dependent plans blocked on "jarvis init scaffolds
OPERATOR_RUNBOOK.md" (not yet shipped at plan time), producing intent-only PRs
that looked complete.

## Direction

A plan run that ends blocked (no `index.md` produced) should make that
unmistakable to the operator and unsafe to merge-and-run. Options to weigh:

- Title/label the PR as blocked (e.g. `plan (BLOCKED): <name>`), and/or
- Don't open a PR at all when no `index.md` was generated — leave the worktree for
  `--resume`/re-plan, or
- Have the PR body lead with the `## Blocker` and a "not runnable" banner.

Whatever the shape: a blocked plan's output must not be mistakable for a complete,
runnable spec. Pair with a `jarvis run` preflight that fails fast with clear
guidance when the spec dir has `intent.md` but no `index.md`.

## Documentation updates

- `v1/docs/plan-mode.md` — document blocked-plan output and PR shape.
- Operator runbook — note the blocked-plan signal so it isn't merged blind.
