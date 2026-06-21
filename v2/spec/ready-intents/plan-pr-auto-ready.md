---
name: plan-pr-auto-ready
---

# Jarvis should flip its own plan PRs to ready in its lifecycle

## Problem

Jarvis's plan-mode PRs come up as **drafts**. Admin-merge refuses a draft, so every plan PR needs
a manual `gh pr ready` first; missing it cost one cascaded failure this session. Jarvis owns the
plan PR lifecycle, so the operator shouldn't have to undraft it by hand.

## Direction

Within the harness's plan PR flow, flip the plan draft PR to ready at the appropriate lifecycle
point (e.g. when the plan completes / the spec is mergeable), so no manual `gh pr ready` is
needed. Use the existing plan PR machinery.

## Out of scope

- Patch/run PR lifecycle (Phase 8 attribution work) — only the plan draft-PR snag.
- Branch-protection / admin-merge authorization — that's operator setup (see operator runbook
  seed), not this.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record plan PRs auto-ready behavior.
- `v1/docs/plan-mode.md` — note plan PRs are made ready by the harness.

## References

- `v1/src/modes/plan/pr.ts` — plan PR creation; where the ready flip belongs.
- `v1/docs/worktrees-and-commits.md` — PR/draft mechanics.
