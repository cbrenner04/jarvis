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

## Prerequisites

- Plan mode opens its spec PR as a GitHub draft.
- The harness owns the plan PR lifecycle (creation in `v1/src/modes/plan/pr.ts`).

## Blocker

The requested deliverable already exists on `main`; no spec drafted.

- `v1/src/modes/plan/pr.ts:300` `maybeMarkPlanPrReady` runs the ready gate then `gh pr ready` on a draft plan PR; no-op when no PR or already ready.
- `v1/src/modes/plan/run.ts:1261` `safeMarkPlanPrReady` is wired into the commit:true completion path (all phases succeed, no blocker) with warn-and-continue.
- `v1/docs/plan-mode.md` §"Auto-mark ready on success" (363–377) and §"Stop conditions → All phases complete" already document the flip and cite `v2/docs/v1-behaviors.md`.

Both prerequisites are confirmed, so the gate passes — but the behavior is implemented, wired, tested, and documented. Drafting this intent as written produces no observable change.

Operator decision needed — what, if anything, is the real gap:
- If the flip simply isn't firing in practice, that's a bug report against existing code, not a new spec — file/repro it.
- If the snag is the **ready gate** stranding plan PRs as draft when the harness test suite fails/flakes on a spec-only change, the intent should be rewritten to target *relaxing or bypassing the gate for plan PRs* (a real, currently-absent behavior). That contradicts the documented gated design, so it needs an explicit decision, not a guess.
- If genuinely already satisfied, close this intent.
