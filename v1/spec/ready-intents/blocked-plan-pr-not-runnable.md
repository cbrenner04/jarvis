---
name: blocked-plan-pr-not-runnable
---

# A blocked plan's PR must be unmistakably non-runnable

A `jarvis plan` run that ends blocked writes only `intent.md` (with a
`## Blocker`) and no `index.md`/subspecs, yet still opens a normal draft PR
titled `plan: <name>` with nothing flagging it as incomplete. On green CI
(which skips index/`lint:md` checks) the operator can merge it blind, landing a
"spec" that has no `index.md` — only discovered at run time as
`spec path does not exist`.

A blocked plan's output must not be mistakable for a complete, runnable spec.
Make the blocked state unmistakable on the PR (and/or skip opening a mergeable
PR): the operator must be unable to merge-and-run it without noticing it is
blocked. The blocker reason should lead the surfaced output. Whatever the shape,
a reader scanning the PR must immediately see it is blocked and not runnable.

## Documentation updates

- `v1/docs/plan-mode.md` — document blocked-plan PR shape/title/banner.
- Operator runbook — note the blocked-plan signal so it isn't merged blind.

## Prerequisites

- Plan mode appends a `## Blocker` to intent.md and commits `plan: blocker` when the prerequisite gate fails without producing index.md
- Plan mode opens and rewrites a draft PR body on plan commits
