# 02 — Slot re-drive survives daemon restart

## Problem

The in-memory waiting set from 01 is lost when the daemon restarts, stranding slot-refused lanes that were awaiting capacity.

## Decisions

- On daemon start, rebuild the waiting set from run rows that are `failed`/`gate_invocation_refused` with durable cause `slot_contention` and `slotRedriveCount` below the bound, ordered by `finishedAt` then run id; rules out a separate persisted queue.
- Rehydration runs after `reconcileOrphanedRuns` (`v2/src/daemon/daemon-run-reconciliation.ts`), which only settles non-terminal rows and so never touches these `failed` rows; rehydrated lanes are not treated as orphans.
- Rebuilt lanes go through the 01 coordinator drain, not a startup-only path; a fresh daemon has no live leases and the limit is 1, so one lane re-drives at startup and the rest wait for releases.
- Rehydration after a self-handoff: rows still owned by a live or reachable draining predecessor generation are not re-driven by the successor; the 01 owner check applies to rebuilt entries, so the successor never races the draining owner.
- The count carries forward from the row; never reset on restart.
- Before dispatch, verify the retained worktree exists and its checkpoint is intact (the resume reconstruction succeeds); if not, log `slot_redrive_refused` with the reason, drop the entry, and leave the row settled for operator diagnosis; rules out silently consuming the bound on an unrecoverable lane.
- Rows at or over the bound stay settled for operator diagnosis and are not rehydrated.

## Task checklist

- [ ] Startup rehydration of slot-refused lanes into the coordinator, after reconciliation.
- [ ] Pre-dispatch worktree/checkpoint check.
- [ ] Restart tests.

## Acceptance criteria

- [x] A daemon restart test persists a slot-refused lane with a nonzero `slotRedriveCount` and uncommitted retained work, restarts the daemon, and proves the lane re-drives with the count incremented from the persisted value (not reset) and the worktree HEAD and retained uncommitted work intact; it fails against the pre-fix code.
- [x] A restart test with two persisted slot-refused lanes proves only the oldest re-drives at startup and the other waits for a release.
- [x] A changeover test with a slot-refused lane owned by a still-reachable draining predecessor proves the successor does not re-drive it or increment its count.
- [x] A restart test proves a persisted lane at the bound is not re-driven.
- [x] A restart test proves a lane whose worktree is missing is dropped with a logged `slot_redrive_refused` and stays `failed`/`gate_invocation_refused`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — pending slot re-drives resume after daemon restart with the durable count and a retained-worktree check.
- `v2/docs/operator-runbook.md` — § Concurrency: one line on automatic re-drive after a daemon restart.
