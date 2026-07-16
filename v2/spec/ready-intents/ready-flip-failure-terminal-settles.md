---
name: ready-flip-failure-terminal-settles
---

# A failed ready flip terminal-settles the workflow

A workflow whose work is committed and whose draft PR exists can remain
`in-progress` after `gh pr ready` fails. The CLI waits forever, the worktree claim
remains held, and recovery incorrectly points to resume.

Settle a failed flip as a terminal non-success, return from `run workflow`, release
the in-memory claim, and make a later invocation reclaimable. The operator error
names the PR and preserved flip cause and does not prescribe resume.

## Decisions

- Terminal-settle a failed ready flip instead of leaving the workflow running or resumable; rules out a non-live `in-progress` row and a hung CLI.
- Release workflow ownership on flip settlement while preserving worktree and branch state; rules out requiring a daemon restart to reclaim the branch.
- Remediate against the named PR and actual flip error, not `resume`; rules out the circular recovery path for already-finished work.

## Documentation updates

- `v2/docs/daemon-host.md` — terminal settlement and claim release.
- `v2/docs/workflow-runner.md` — failed-flip workflow outcome.
- `v2/docs/write-behavior.md` — non-resumable ready-flip boundary.
- `v2/docs/operator-runbook.md` — failed-flip recovery without resume or daemon restart.
- `v2/docs/v1-behaviors.md` — record the changed v2 settlement behavior.

## Prerequisites

- Ready-gate and ready-flip failures are distinct in terminal logs and `run list`.
- Publication and ready-flip failures preserve their normalized command cause.
