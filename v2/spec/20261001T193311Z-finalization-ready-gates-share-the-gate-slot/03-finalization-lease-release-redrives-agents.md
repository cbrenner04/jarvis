# 03 — Finalization lease release re-drives agent gates

## Problem

Slot-refused agent gates re-drive when an agent-held lease releases (`daemon-slot-redrive.ts` via 00's subscription); harness finalization gates today spawn without a lease, so their completion never frees the slot for waiting lanes.

## Decisions

- No coordinator logic change beyond releases from harness-held leases firing the existing release subscription; agent gates refused during a held finalization lease still settle `slot_contention` and re-drive on release as today; rules out a separate finalization-specific redrive queue.

## Task checklist

- [ ] Confirm finalization and terminal paths from 01–02 release through the shared lease module so 00 listeners fire.
- [ ] Extend `daemon-slot-redrive.test.ts` with a harness-held lease release scenario.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-slot-redrive.test.ts` proves a finalization-lease release triggers the `slot_contention` automatic re-drive path; fails against pre-fix code where finalization spawns without a lease (reachable on main today).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — finalization and terminal gate releases participate in the same redrive wakeups as agent gate releases (cross-link `v2/docs/operator-runbook.md` § Concurrency).
