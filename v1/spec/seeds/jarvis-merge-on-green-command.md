---
name: jarvis-merge-on-green-command
---

# Fold the operator merge-on-green dance into a jarvis command

## Problem

To land any completed run/plan/intent PR, the operator manually runs
`gh pr ready` → `gh pr checks <n> --watch` → `gh pr merge --admin --squash`,
~10× per session. The load-bearing rule — **never admin-merge until CI is
green** (admin overrides approval/up-to-date, *not* the checks) — lives only in
operator habit. This session it was violated: admin-merging draft/non-green
plan+intent PRs let lint-dirty markdown onto `main` and poisoned the run
completion gate for hours. Nothing in the harness enforces the gate.

This is the single most-repeated non-jarvis step in an observer session, and the
one whose omission did the most damage.

## Direction

Fold the merge step into jarvis so the green-gate can't be skipped. Weigh:

- A `jarvis merge <pr|worktree|spec>` that **refuses unless CI checks are green**
  (and/or runs `bun run ready` locally), then admin-merges (squash). Reports the
  failing check instead of merging on red.
- vs. extending `triage --mark-ready` to optionally **merge on green** once the
  gate passes, so promotion and merge are one gated step.

The operator still reviews the diff for correctness/scope/secrets before
invoking — this folds the *mechanical* ready→wait-green→admin-merge, not the
judgment.

## Out of scope

- Replacing human diff review.
- Auto-merging without an explicit operator invocation.

## References

- Observer merge flow: `v1/docs/operator-runbook.md` (Merging, The gate).
- Existing nearest commands: `jarvis1 triage`, `jarvis1 cleanup`.
