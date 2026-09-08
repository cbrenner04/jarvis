---
name: reap-verifier-process-groups
---

# Reap recorded verifier process groups on run termination

## Prerequisites

- A run can durably carry multiple concurrent verifier process-group ids without overwriting earlier groups.
- Sweep-candidate listing returns every recorded group for a non-live owning run.
- The base-ref reproduction probe records its in-flight process group on the owning run row.
- Diff-derived mutation verifier scoped `bun test` spawns record their process group on the owning run row.
- Runtime smoke verifier spawns record their process group on the owning run row.
- Ready-gate and required-integration spawns record through the generalized multi-group persistence API.

## Primary implementation surface

- Daemon: orphan sweep and live run termination in `v2/src/daemon/daemon.ts`

## Problem

Daemon startup sweep and live run termination signal only the ready-gate group recorded in `ready_gate_pgid`. Recorded verifier groups from base-ref probe, diff-derived mutation verifier, and runtime smoke verifier are never signalled, so their `bun test` descendants leak across kills, timeouts, and daemon restarts.

## Decision ledger

- Daemon startup sweep signals every recorded group for each non-live candidate run, not only the ready-gate group; rules out gate-only startup reaping.
- Live run termination signals every recorded group for the killed run before quiescence wait; rules out aborting only the controller while verifier children survive.
- Signalling remains SIGTERM→SIGKILL against the process group with the existing grace; rules out per-PID walking that loses re-spawned cohorts.
- After signalling or determining a group is already gone, clear that group's durable record; rules out leaving swept ids on the row.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts` proves every recorded group for a non-live run is signalled at daemon start, not just the ready-gate group; it fails against the pre-fix gate-only sweep.
- [ ] A daemon run-control regression proves terminating a live run signals every verifier process group recorded so far; it fails when only the gate group is signalled.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the leaked-`bun test` gotcha states that all four finalization spawns are bound, and drops the reference to the reaped `reap-ready-gate-test-children-on-run-termination` seed; keep diagnostic recipes (attribute by CPU and parentage, not age).
- `v2/docs/daemon-host.md` — document multi-group verifier sweep at daemon start and pre-quiescence signalling on live run termination.
- `v2/docs/v1-behaviors.md` — record daemon-side reaping of every recorded finalization verifier process group.
