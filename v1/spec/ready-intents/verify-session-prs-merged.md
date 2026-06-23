---
name: verify-session-prs-merged
---

# Verify outstanding Jarvis PRs at session end

## Behavior

`jarvis1 triage` gives the operator one session-end verdict for every current Jarvis-managed worktree: all work landed, or the named worktrees that still need action. Each outstanding entry identifies its PR state (including draft versus ready) and GitHub-reported merge-blocking gate state when available, so a failed merge cannot be mistaken for a completed session.

## Decisions

- Extend no-argument `jarvis1 triage` for the session-end sweep — rules out a new merge/status command because triage already owns worktree and PR inspection.
- Sweep current Jarvis-managed worktrees, not a newly persisted session identity — rules out ungrounded session tracking while retaining every uncleaned outcome the operator must reconcile.
- Report only; never merge, retry a merge, or intercept external `gh pr merge` calls — rules out auto-merge without operator sign-off.

## Documentation updates

- `v2/docs/v1-behaviors.md` — session-end PR verdict and outstanding-state behavior.

## Prerequisites

