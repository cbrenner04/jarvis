---
name: intent-completion-fails-when-split-renames-output
---

# Intent completion fails (completion_commit_failed) when the split renames or multiplies output

## Problem

Three `jarvis run workflow intent` runs (2026-07-17) all settled `completion_commit_failed`
(retryable), and `jarvis run resume` replayed the **same** failure 3/3. The worktree showed the real
cause: the split produced ready-intents whose **names differ from the seed** and/or produced **two**
outputs, all left **uncommitted**. Example — seed `acceptance-criteria-must-be-satisfiable-by-the-agent`
produced untracked `agent-verifiable-acceptance-criterion-rule.md` +
`plan-review-rejects-unsatisfiable-criteria.md`, plus an unstaged seed delete. The completion
committer apparently looks for output at a seed-name-derived path, doesn't find it, returns "no new
commit" over a dirty tree → `completion_commit_failed`; resume can't fix it because the naming never
matches.

## Decisions

- Completion should commit **whatever the split actually produced** (staged adds/deletes/renames of
  `ready-intents/*` and the consumed seed), not a seed-name-derived path; rules out stranding valid
  output because the split renamed or multiplied it.
- A split producing multiple ready-intents is valid; publication must handle N outputs; rules out a
  one-output assumption. Relates to `an-intent-run-publishes-two-prs-for-one-split`.

## Documentation updates

- `v2/docs/workflow-runner.md` — intent completion commits the actual split output set.
