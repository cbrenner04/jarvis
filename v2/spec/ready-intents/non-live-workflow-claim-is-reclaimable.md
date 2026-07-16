---
name: non-live-workflow-claim-is-reclaimable
---

# A non-live workflow cannot strand its worktree claim

When a workflow claim remains after its owner is no longer live, a new invocation on the same
project and branch reclaims the claim without bouncing the daemon. A genuinely live owner still
causes `worktree_claimed`.

## Decisions

- Validate claim ownership against daemon liveness at admission; rules out trusting an orphaned in-memory claim indefinitely.
- Reclaim only from a non-live owner; rules out admitting concurrent workflows into one worktree.

## Prerequisites

## Out of scope

- Redesigning claim keys or ownership.
- Reclaiming worktrees or branches from disk.

## Documentation updates

- `v2/docs/daemon-host.md` — stale-claim admission and live-owner protection.
- `v2/docs/operator-runbook.md` — re-invocation recovery without daemon restart.
- `v2/docs/v1-behaviors.md` — changed v2 worktree-claim behavior.
