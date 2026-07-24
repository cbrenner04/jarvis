---
name: commit-each-write-iteration
---

# Commit each write-loop iteration, not just the completion boundary

## Problem

Git commits happen only at the write-loop completion boundary (`createCompletionCommitter()` on settle).
Per-iteration `store.commitCompletionBoundary(...)` calls are state-store boundaries, not git commits.
Agent work across N iterations stays uncommitted until the run completes.

A killed, timed-out, or daemon-reconciled run loses uncommitted iteration work; `resetStaleWorkspace` on an
incomplete implement re-run discards the same work. The PR shows one completion commit, so per-iteration
history is invisible. v1's patch loop commits per iteration; v2 regressed.

## Decisions

- Commit at the end of each write-loop iteration that changed files, with a message identifying the iteration and active spec/subspec and the existing `Jarvis-Agent:` trailer; rules out deferring all git commits to the completion boundary only.
- Unchanged iterations produce no git commit; rules out empty or marker-only commits.
- Reuse `createCompletionCommitter()` / the existing committer seam; rules out a parallel ad-hoc git commit path.
- Completion boundary keeps today's contract (`completion_commit_failed` when the worktree is dirty and the committer returns no new commit); rules out replacing or weakening the terminal publish commit.
- Publication (push + PR) stays at the completion boundary only; rules out pushing after each iteration.
- PR attribution and narrative marker blocks must stay correct on multi-commit branches; rules out assuming a single completion commit for footer rendering.

## Acceptance criteria

- [ ] A write loop that changes files across multiple iterations produces one commit per changed iteration on the run's branch, each carrying the `Jarvis-Agent:` trailer.
- [ ] An iteration that changes nothing produces no commit.
- [ ] A run killed mid-loop leaves prior iterations' work committed on the branch.
- [ ] The completion boundary still reports `completion_commit_failed` when the worktree is dirty and no new commit is produced.
- [ ] The PR attribution footer renders correctly for a multi-commit branch.
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — per-iteration commit contract.
- `v2/docs/operator-runbook.md` — recovery expectations after a killed run.
- `v2/docs/v1-behaviors.md` — record v2 parity with v1's per-iteration commits.

## Prerequisites

None.
