---
name: cleanup-retires-failed-abandoned-runs
---

# cleanup (or a new abandon command) retires failed/abandoned runs

## Problem

`jarvis1 cleanup` only removes worktrees whose PRs **merged**. When a run fails,
is contaminated, or is otherwise abandoned without merging, the operator
manually runs `gh pr close <n>` + `git worktree remove --force <wt>` +
`git branch -D <branch>` (+ `git push origin --delete <branch>`) before a clean
re-run. Done repeatedly this session (#579, #582 — contaminated/red runs).
Skipping any part leaves residual state: a closed PR's branch blocks a fresh
draft PR for the same spec, or an orphan worktree collides on re-run.

## Direction

Give abandonment a jarvis command instead of a manual gh+git sequence. Weigh:

- Extend `jarvis1 cleanup` to also retire **abandoned** runs (closed/none PR,
  unmerged) — remove the worktree, delete the local+remote branch — leaving the
  **source spec intact** so `jarvis1 run` re-runs cleanly.
- vs. a dedicated `jarvis1 abandon <worktree|spec>` that closes the draft PR,
  removes the worktree, and deletes the branches in one step.

Coordinate with the residual-state normalization in
`cascade-retry-transient-and-normalize-residual-state` (#585) so a failed run
leaves a state these commands can retire deterministically.

## Out of scope

- Deciding *which* runs to abandon (operator judgment).
- Archiving completed specs (already in `cleanup`).

## References

- `jarvis1 cleanup` (merged-only today), `jarvis1 triage`.
- Residual-state sibling: `cascade-retry-transient-and-normalize-residual-state`
  (intake #585).
