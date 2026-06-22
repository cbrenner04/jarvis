# Auto-ready the intent draft PR

## Problem

`jarvis1 intent` (commit mode) opens its split PR as a draft and leaves it
draft — the operator flips it by hand. Plan mode already auto-readies its PR
(ready gate + `gh pr ready`) before handing off. Mirror that on the intent path.

## Decisions

- Reuse plan's `maybeMarkPlanPrReady` (ready gate → `gh pr ready`, with its draft/ready/none state guard) — rules out a bespoke intent ready path that drifts from plan's gate + retry logic.
- Wrap the call warn-and-continue (like `safeMarkPlanPrReady`): a gate or `gh` failure prints a warning, leaves the PR draft, and intent still exits 0 — rules out failing an otherwise-successful split on a post-handoff readiness step.
- Scope to the `commit: true` path only; `commit: false` writes no PR — rules out a spurious `gh` call in the external path.
- Auto-ready inherits plan's `bun run ready` gate: a missing or failing gate hits the warn-and-continue path and leaves the PR draft — rules out reading "auto-ready" as unconditional.
- Leave the intent run's printed next-steps string ("Review the draft PR …") identical to plan's; it prints before auto-ready, same as plan, and consistency beats a cosmetic divergence since the PR is readied immediately after — rules out a wording-update task.

## Task checklist

- [ ] After `ensureDraftPr` succeeds in the `commit: true` intent path, run the auto-ready (gate + `gh pr ready`) wrapped warn-and-continue.
- [ ] Update `v1/docs/intent-mode.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A successful committed `jarvis1 intent` run leaves its PR ready (not draft) after the split commit, via the same ready-gate + `gh pr ready` step plan mode uses.
- [ ] If the ready gate or `gh pr ready` fails, the intent run still exits 0, prints a warning, and leaves the PR draft.
- [ ] No-commit (`commit: false`) intent runs are unchanged: no PR, no `gh pr ready`.
- [ ] Re-running on an already-ready PR is a no-op (state guard) and still exits 0.

## Documentation updates

- `v1/docs/intent-mode.md` — committed intent PRs auto-ready like plan PRs (gate + `gh pr ready`); flow diagram no longer ends at "open draft PR".
- `v2/docs/v1-behaviors.md` — update the committed-mode intent bullet (currently "open or update a draft PR for operator review") to record the auto-ready transition.
