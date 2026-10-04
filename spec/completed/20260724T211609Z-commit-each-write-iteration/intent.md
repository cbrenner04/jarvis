---
name: commit-each-write-iteration
---

# Commit each write-loop iteration, not just the completion boundary

## Problem

Git commits happen only at the write-loop completion boundary (`createCompletionCommitter()` on settle).
Per-iteration `store.commitCompletionBoundary(...)` calls are state-store boundaries, not git commits.
Agent work across N iterations stays uncommitted until the run completes.

On the **same run branch** (kill, daemon reconcile, resume while the branch still exists), uncommitted
iteration edits can be lost. A fresh **implement re-run** after an incomplete run still runs
`resetStaleWorkspace`, which tears down the branch and unpushed SHAs — per-iteration commits do not
preserve work across that reset. The PR shows one completion commit, so per-iteration history is
invisible. v1's patch loop commits per iteration; v2 regressed.

## Decisions

- Commit at the end of each in-scope `progress` iteration that materializes a worktree diff vs `HEAD`,
  using the existing committer seam with `Jarvis-Agent:` and an attribution-compatible body (`Spec:` line
  with the resolved subspec path); exact iteration subject template deferred.
- Unchanged iterations produce no git commit; rules out empty or marker-only commits.
- Reuse `createCompletionCommitter()` / the existing committer seam; rules out a parallel ad-hoc git commit path.
- Completion boundary keeps today's contract (`completion_commit_failed` when the worktree is dirty and the committer returns no new commit); rules out replacing or weakening the terminal publish commit.
- Terminal `complete` produces a distinct completion SHA for attribution and publish-resume when the worktree is clean and `HEAD` already carries `Jarvis-Agent:` from the last iteration commit — terminal invocation bypasses iteration HEAD-reuse short-circuit, not left to ad-hoc behavior.
- Publication (push + PR) stays at the completion boundary only; rules out pushing after each iteration.
- PR attribution and narrative marker blocks must stay correct on multi-commit branches; rules out assuming a single completion commit for footer rendering.
- `iteration_timeout` is out of scope for per-iteration git commits in this spec (v2 timeout today records only SQLite boundaries; v1 WIP checkpoint on iteration-timeout remains documented in `v1-behaviors.md`).
- Git-backed write loops with `publishCompletion !== false` only; non-git / `publishCompletion === false` loops are out of scope for per-iteration git recovery.

## Acceptance criteria

- [ ] A write loop that changes files across multiple `progress` iterations produces one commit per changed iteration on the run's branch, each carrying `Jarvis-Agent:` and a `Spec:` body line for the active subspec path.
- [ ] A `progress` iteration that materializes no diff vs `HEAD` produces no commit.
- [ ] A run killed after a settled changed `progress` iteration leaves that iteration's commit on the branch (between-iteration or post-settle abort before the next iteration).
- [ ] The completion boundary still reports `completion_commit_failed` when the worktree is dirty and no new commit is produced.
- [ ] The PR attribution footer renders correctly for a multi-commit branch including iteration SHAs and the terminal completion SHA policy above.
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — per-iteration commit contract.
- `v2/docs/operator-runbook.md` — recovery expectations: same-branch kill/reconcile vs implement re-run reset.
- `v2/docs/v1-behaviors.md` — record v2 parity with v1's per-iteration commits; note timeout checkpoint not in v2 scope here.

## Prerequisites

None.
