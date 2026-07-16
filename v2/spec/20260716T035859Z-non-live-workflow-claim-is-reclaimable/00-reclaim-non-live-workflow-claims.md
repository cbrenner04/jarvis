# 00 - Reclaim non-live workflow claims

## Problem

An orphaned in-memory workflow claim can reject every later invocation for the same `(project, branch)` until the daemon restarts.

## Decisions

- Correlate a workflow claim with daemon-tracked workflow liveness at admission; rules out treating registry membership or durable run status alone as proof of a live owner.
- Release and replace only a claim whose workflow owner is no longer live; rules out admitting concurrent workflows under one `(project, branch)`.
- Reclaim only daemon memory state; rules out pruning or recreating worktrees and branches on disk.
- Preserve queued-run admission ahead of live-claim validation; rules out stale-claim recovery bypassing an existing queued owner.

## Scope

- Make workflow-start admission discard an orphaned workflow claim before acquiring the same key for a new invocation.
- Keep workflow claim ownership correlated with the daemon's live execution state through acquisition and cleanup.
- Cover stale-owner recovery and live-owner rejection at the daemon handler boundary.

## Out of scope

- Claim keys and worktree ownership remain `(project, branch)`; rules out a registry redesign.
- Disk worktree and branch reclamation remain unchanged; rules out cleanup side effects during admission.

## Acceptance criteria

- [ ] A regression test in `v2/src/daemon/daemon-workflow-start.test.ts` leaves a workflow claim whose owner is no longer live, then proves a new invocation for the same `(project, branch)` starts without restarting the daemon; it fails against the pre-fix code.
- [ ] `v2/src/daemon/daemon-workflow-start.test.ts` proves a genuinely live workflow owner still rejects a new same-key invocation with `worktree_claimed`.
- [ ] Existing same-key bare-run and queued-run cases in `v2/src/daemon/daemon-workflow-start.test.ts` stay green.
- [ ] Stale-claim admission changes no worktree or branch state on disk.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` describe stale workflow-claim reclamation and live-owner protection in their durable homes.

## Documentation updates

- `v2/docs/daemon-host.md` — make stale-owner validation and live-owner rejection part of workflow admission and in-memory ownership contracts.
- `v2/docs/operator-runbook.md` — re-invoke the workflow after a non-live claim instead of restarting the daemon.
- `v2/docs/v1-behaviors.md` — record the changed v2 worktree-claim behavior for parity review.
