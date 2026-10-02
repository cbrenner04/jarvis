---
name: chained-lane-rebases-after-predecessor-merge
---

# Chained fan-out lanes rebase onto main after their predecessor merges

## Problem

Serial chained fan-out lanes (#4484) fork a dependent lane's plan and implement branches from the predecessor lane's implement branch. The dependent PR targets `main` and carries the predecessor's commits until they merge; after a squash-merge those commits have different SHAs on `main`, so the dependent lane conflicts and the operator hand-runs `git rebase --onto origin/main <predecessor-tip>`.

## Decisions

- After a predecessor lane's implement PR merges, the harness rebases each open dependent lane branch with `git rebase --onto origin/main <predecessor-tip>` before its next dispatch or publication. Rules out merging `main` into the lane (keeps the stacked commits).
- A rebase conflict refuses the lane with a diagnosable stage failure naming the predecessor; no partial rebase is left behind.

## Acceptance criteria

- [ ] A dependent lane whose predecessor squash-merged is rebased onto `main` so its PR diff carries only its own commits; pinned by a test.
- [ ] A conflicting rebase aborts cleanly and fails the lane naming the predecessor; pinned by a test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` § Fan-out lanes; `v2/docs/operator-runbook.md` — drop the hand-rebase step from the stacked-fork gotcha.
