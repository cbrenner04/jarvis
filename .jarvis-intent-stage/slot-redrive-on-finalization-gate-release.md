---
name: slot-redrive-on-finalization-gate-release
---

# Finalization gate lease release re-drives slot-contention agent gates

## Problem

Slot redrive listens for agent gate lease releases; harness finalization gates did not hold the slot, so a lane refused for `slot_contention` while finalization ran full suites would not re-drive until an agent gate finished.

## Decisions

- No coordinator logic change beyond releases from harness-held leases firing the existing release subscription; agent gates refused during a held finalization lease still settle `slot_contention` and re-drive on release as today.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-slot-redrive.test.ts` proves a finalization-lease release triggers the `slot_contention` automatic re-drive path; fails against pre-fix code where finalization spawns without a lease (reachable on main today).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — note that finalization and terminal gate releases participate in the same redrive wakeups as agent gate releases (cross-link operator-runbook § Concurrency if not already updated by the finalization intent).

## Prerequisites

- Gate invocation lease accounting lives in `v2/src/execution/gate-invocation-lease.ts` with refuse acquire, live-lease counting, and release subscriptions consumed by the write loop and daemon slot redrive.
- `awaitGateInvocationLease` queues waiters in FIFO order and returns an owned releasable lease when the slot frees, with abort and timeout rejection.
- Harness-run ready finalization gates (default ready gate, required integration, and repair re-gates) await the slot, hold through subprocess spawn, and release in `finally`.
