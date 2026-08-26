---
name: implement-completion-publishes-despite-no-work-shrink
---

# Completion tail publishes a completed spec whose shrink returns no work

Unsplit rationale: the defect and every decision live in the shared `executeWorkflow` completion tail in `v2/src/execution/workflow-runner.ts` (publication gating and publishing-identity resolution); the pipeline path consumes that tail unchanged, so there is no second module boundary to split against.

## Primary implementation surface

- Execution loop — `v2/src/execution/workflow-runner.ts` completion publication tail

## Problem

A standalone `jarvis run workflow implement` can complete a spec — acceptance criteria ticked, index box ticked, real commits on the worktree branch — and still never push the branch or open a draft PR, reporting `completed`. Observed 2026-08-23 on `20260823T000833Z-dismiss-run-durable-flag`: the post-implement shrink recorded `iteration_commit skipReason: "no_file_changes"` and a `no-work` boundary that self-completed the run, the tail completion committer produced no `commitSha` over the clean worktree, and the push + `gh pr create --draft` block (guarded by `published.commitSha !== undefined`) was skipped. The operator hand-published.

The same tail skips publication entirely when no `publicationAgent` resolves. Pipeline implement stages inherit the defect: terminal publication only ready-flips an existing draft PR, so a no-work shrink leaves it with no draft to flip.

## Decisions

- Publication keys off "the completed branch has commits ahead of its resolved base that are not yet published", not off a fresh tail commit produced this boundary — rules out equating "no new commit at this boundary" with "nothing to publish".
- A run that produced zero commits against a clean worktree still does not push or open a PR — rules out pushing a branch equal to base.
- An unresolved publishing identity does not skip publication for a completed spec with publishable commits: resolve it from the attribution that produced the commits, or publish without agent attribution — rules out silently dropping the PR when the final boundary attributed no agent.
- The change lands in the shared completion tail so standalone and pipeline implement stages both publish; the pipeline stage then ready-flips the created draft via existing terminal publication — rules out a standalone-only or pipeline-only patch.
- The existing uncommitted-work failure path (a no-`commitSha` tail with dirty named paths still fails `completion_commit_failed`) is preserved — rules out turning a dirty-worktree failure into a publish.

## Behaviors

- An implement workflow reaching `complete` via a `no-work`/`no_file_changes` shrink, atop a branch with real completed-spec commits ahead of base, pushes the branch and creates the draft PR.
- A run with no commits against a clean worktree neither pushes nor opens a PR.
- A completed spec whose final boundary attributed no completion agent but whose branch has publishable commits still publishes — or the plan shows that path is unreachable and removes the gate.
- A pipeline implement stage whose shrink no-works yields a draft PR for terminal publication to ready-flip.

## Prerequisites

- The shared `executeWorkflow` completion tail pushes the branch and creates the draft PR when the tail completion committer yields a commit sha.
- Individual workflow steps never publish; the trailing `~shrink` step is the publishing boundary for an implement workflow.
- A `no-work`/`no_file_changes` shrink boundary self-completes its run and returns a `complete` result to the workflow tail.
- Pipeline terminal publication ready-flips or merges an existing draft PR and never creates one.

## Documentation updates

- `v2/docs/workflow-runner.md` — completion publication contract: publication fires whenever the completed branch carries unpublished commits ahead of base, not only when the final boundary produced a fresh commit.
- `v2/docs/operator-runbook.md` — drop or correct any note implying a `completed` implement always yields a PR; record the hand-publish fallback (`git push origin HEAD:<branch>` + `gh pr create`) for a stranded completed implement.
- `v2/docs/v1-behaviors.md` — this changes existing publication behavior; record what it now is.
