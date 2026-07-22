---
name: delete-remote-artifacts-last-during-retirement
---

# Delete remote artifacts last during workspace retirement

## Problem

`performAbandonmentSteps` closes the PR first, then removes the worktree, then deletes the local
branch, then the remote branch. The two irreversible, remote-visible mutations (PR closure, remote
branch deletion) run at opposite ends, so a failure partway through teardown can leave the operator
with a closed PR and a local workspace that was never cleaned — the worst of both. Local teardown is
cheap to redo; remote teardown is not recoverable.

## Decisions

- Order retirement local-first: worktree removal and local branch deletion, then remote branch
  deletion, then PR closure. Rules out the current PR-closure-first order and any "close the PR to
  claim the workspace" compromise.
- Close the PR last because an open PR is the operator-visible marker that retirement did not
  finish; a closed PR whose branch still exists reads as done when it is not. Rules out closing the
  PR before deleting the remote branch.
- Abort retirement at the first failing step and report it, leaving every later artifact intact —
  including a remote-branch-deletion failure, which stops before PR closure, and a PR-closure
  failure, which leaves the PR open with everything else gone. Rules out best-effort continuation
  past a failed step.
- Do not make retirement transactional or undoable. Rules out restoring a deleted remote branch or
  reopening a closed PR.

## Acceptance criteria

- [ ] Retirement performs worktree removal and local branch deletion before any remote branch
      deletion or PR closure.
- [ ] A retirement whose local teardown fails leaves the remote branch and the open PR untouched and
      reports the failure.
- [ ] A retirement whose remote branch deletion fails leaves the PR open and reports the failure.
- [ ] A retirement that fully succeeds still ends with no worktree, no local branch, no remote
      branch, and a closed PR.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § stale-workspace retirement — teardown order and where a partial
  retirement can stop.
- `v2/docs/v1-behaviors.md` — record the changed retirement order.

## Prerequisites
