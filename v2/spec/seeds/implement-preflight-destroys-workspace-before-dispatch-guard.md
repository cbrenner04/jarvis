# Implement preflight destroys the workspace before the dispatch guard can refuse

## Problem

`jarvis run workflow implement` retires the stale workspace — closing the open draft PR, removing
the worktree, and deleting the local *and remote* branches — **before** the revision-mismatch
dispatch guard runs. When that guard then refuses, the run never starts and the prior attempt's work
is already gone.

Observed 2026-07-21, re-running `20260721T115738Z-workflow-command-reports-terminal-workflow-failure`
while seven other implement runs were live. Single invocation, in this order:

```text
Closed PR #1911
Removed worktree: ~/.jarvis/worktrees/jarvis/20260721T115738Z-workflow-command-reports-terminal-workflow-failure
Deleted local branch: 20260721T115738Z-workflow-command-reports-terminal-workflow-failure
Deleted remote branch: 20260721T115738Z-workflow-command-reports-terminal-workflow-failure
daemon revision mismatch: loaded=d080c923… current=d13f6bf3…; cannot restart while live runs: 973bdac4…, 38e09126…, 73d155ab…, d3f9f7d8…, 131bda4b…, 4f753a9c…, 57e378f7…
```

Exit without dispatch. No run row, no worktree, no branch, no PR — the branch's commits survive only
in the closed PR's refs on GitHub.

The refusal itself is correct and documented (`operator-runbook.md` § Bounce the daemon). The defect
is ordering: an irreversible, remote-visible mutation is performed ahead of a check that can and did
reject the invocation. The operator's recovery is strictly worse than if nothing had happened.

Note the interaction: any merge touching `v2/src/**` makes the daemon stale, and a stale daemon
cannot bounce while runs are live. So the more concurrent work in flight, the more likely this
guard fires — and the more likely the operator destroys a workspace for a run that cannot start.
`dispatch-to-digest-keyed-daemon` removes this particular guard, but the ordering bug outlives it:
any preflight refusal after retirement has the same shape.

## Decisions

- Establish that the run can dispatch before mutating any workspace state. Rules out reordering only
  the revision guard while leaving other refusals after retirement.
- Treat remote branch deletion and PR closure as the last steps of retirement, after every refusal
  path has been cleared. Rules out a "retire locally, then check" compromise that still deletes the
  remote branch.
- On a refusal that arrives after retirement has begun, report exactly what was already destroyed.
  Rules out a bare refusal message that leaves the operator to discover the deletions.
- Do not make retirement transactional/undoable. Rules out attempting to restore a deleted remote
  branch or reopen a closed PR.

## Acceptance criteria

- [ ] An `implement` invocation that will be refused by the revision-mismatch guard performs no PR
      closure, worktree removal, or branch deletion.
- [ ] Regression coverage drives a stale-daemon-with-live-runs refusal against an existing
      workspace and asserts the PR, worktree, and both branch refs still exist; it fails against the
      current ordering.
- [ ] The happy path still retires the stale workspace and dispatches, unchanged.
- [ ] Any refusal path reached after retirement has started names the already-destroyed artifacts on
      stderr.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Implement workflow — preflight retirement happens only after the
  invocation is known to be dispatchable.
