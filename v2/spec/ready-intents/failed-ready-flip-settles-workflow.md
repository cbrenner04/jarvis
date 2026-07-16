---
name: failed-ready-flip-settles-workflow
---

# A failed ready flip settles the workflow

When publication succeeds but `gh pr ready` fails, the workflow reaches a terminal non-success
outcome instead of remaining `in-progress` / `not-live`. `jarvis run workflow` returns that outcome,
and terminal settlement releases the workflow's worktree claim so the same seed can be invoked again.

The operator-facing failure names the draft PR and preserved ready-flip error. Its remediation is to
inspect or flip that PR, never to resume completed work.

## Decisions

- Settle the workflow after bounded finalization; rules out treating a failed flip as live work.
- Release the claim as part of terminal settlement; rules out requiring CLI exit or daemon restart for cleanup.
- Report PR identity and the ready-flip error with manual-flip remediation; rules out advising `resume`.

## Prerequisites

- Publication failure handling preserves the underlying subprocess error and retries only classified retryable failures.

## Out of scope

- Explaining why the daemon's flip failed when the same command later succeeds manually.
- Changing the worktree claim ownership model.

## Documentation updates

- `v2/docs/operator-runbook.md` — failed ready-flip recovery and removal of resume advice.
- `v2/docs/daemon-host.md` — terminal settlement, workflow wait completion, and claim release.
- `v2/docs/write-behavior.md` — ready-flip outcome and CLI remediation contract.
- `v2/docs/v1-behaviors.md` — changed v2 finalization behavior.
