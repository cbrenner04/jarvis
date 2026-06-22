---
name: intent-pr-auto-ready
---

# Intent PRs don't auto-ready (plan PRs do)

## Problem

Plan-mode PRs flip from draft to ready automatically before merge, but **`jarvis1 intent` PRs stay
draft** — there's no auto-ready path for them. Minor, low priority: the overlord now bypasses intent
mode entirely for single-behavior seeds (hand-promote wip→ready + plan directly), so the draft-PR
snag rarely bites. Captured so it isn't rediscovered.

## Direction

Mirror the plan-PR auto-ready behavior on the intent path: after the intent run's emitted ready-intents
are committed and the gate is satisfied, mark the intent PR ready (the same `gh pr ready` step plan
uses), rather than leaving it draft for the operator to flip by hand.

## Out of scope

- The intent-split emit-contract flake — separate finding ([[intent-split-emit-contract-flaky]]).
- Reworking intent mode broadly — this is one missing auto-ready step.

## Documentation updates

- `v1/docs/intent-mode.md` — note intent PRs auto-ready like plan PRs.

## References

- `v1/src/modes/plan/pr.ts` (the plan-PR ready path to mirror); `v1/src/commands/intent.ts` (intent
  PR creation).
- Priority: low — hand-promotion bypasses intent mode, so this rarely surfaces.

## Prerequisites

none
