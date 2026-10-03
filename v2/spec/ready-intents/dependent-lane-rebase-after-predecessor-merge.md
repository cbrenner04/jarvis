---
name: dependent-lane-rebase-after-predecessor-merge
---

# Dependent lanes rebase onto main after their predecessor's implement PR merges

## Problem

Serial chained fan-out lanes fork a dependent lane's plan and implement branches from the predecessor lane's implement branch (`v2/src/daemon/pipeline-lane-chain.ts`). The dependent PR targets `main` and carries the predecessor's commits until they merge; after a squash-merge those commits have different SHAs on `main`, so the dependent lane conflicts and the operator hand-runs `git rebase --onto origin/main <predecessor-tip>` (`v2/docs/operator-runbook.md` stacked-fork gotcha).

Unsplit rationale: the merge detection and rebase both live in the pipeline lane execution path; no shared primitive is needed.

## Decisions

- After a predecessor lane's implement PR merges, the harness rebases each open dependent lane branch with `git rebase --onto origin/main <predecessor-tip>` before its next dispatch or publication. Rules out merging `main` into the lane (keeps the stacked commits).
- A rebase conflict refuses the lane with a diagnosable stage failure naming the predecessor; no partial rebase is left behind.

## Prerequisites

## Acceptance criteria

- [ ] `pipeline-execution.test.ts`: a dependent lane whose predecessor squash-merged is rebased onto `main` so its PR diff carries only its own commits; fails against current code (no rebase on merge).
- [ ] `pipeline-execution.test.ts`: a conflicting rebase aborts cleanly and fails the lane naming the predecessor; fails against current code.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` § Fan-out lanes — document dependent lane auto-rebase after predecessor squash-merge and rebase conflict handling.
- `v2/docs/operator-runbook.md` § Known gotchas (Stacked forks bullet) — replace hand-rebase workaround with auto-rebase behavior and conflict-handling guidance.
- `v2/docs/v1-behaviors.md` — record dependent lane auto-rebase after predecessor merge.

## Primary implementation surface

- `v2/src/daemon/pipeline-execution.ts` (fan-out settlement reconciliation and predecessor-merge detection for dependent lane rebase before dispatch/publication)
