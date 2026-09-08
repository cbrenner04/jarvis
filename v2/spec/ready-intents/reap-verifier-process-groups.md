---
name: reap-verifier-process-groups
---

# Reap recorded verifier process groups at daemon startup

## Prerequisites

- A run can durably carry multiple concurrent verifier process-group ids without overwriting earlier groups.
- Sweep-candidate listing returns every recorded group for a non-live owning run.
- `clearVerifierProcessGroup(runId, pgid)` removes one recorded id after settlement or sweep.
- The base-ref reproduction probe records its in-flight process group on the owning run row.
- Diff-derived mutation verifier scoped `bun test` spawns record their process group on the owning run row.
- Runtime smoke verifier spawns record their process group on the owning run row.
- Ready-gate and required-integration spawns record through the generalized multi-group persistence API.
- Live run termination pre-quiescence signalling of every recorded group is owned by `make-run-kill-rpc-report-settlement` (today's kill handler aborts the controller only; ready-gate/required-integration live termination already uses `AbortSignal` + `processGroup` in the execution loop, not `ready_gate_pgid` reads).

## Primary implementation surface

- Daemon: orphan sweep in `v2/src/daemon/daemon.ts`

## Problem

Daemon startup sweep signals only the single group in `ready_gate_pgid`. After `record-verifier-spawn-process-groups`, base-ref probe, diff-derived mutation verifier, and runtime smoke verifier groups are durably recorded but startup sweep still reaps only the gate column, so their `bun test` descendants leak across daemon restarts and dead-owner recovery. Live kill of those three spawns is a separate gap closed by durable recording plus `make-run-kill-rpc-report-settlement`, not by extending today's gate-only startup sweep.

## Decision ledger

- Daemon startup sweep signals every recorded group for each non-live candidate run, not only the ready-gate group; rules out gate-only startup reaping.
- Signalling remains SIGTERM→SIGKILL against the process group with the existing grace; rules out per-PID walking that loses re-spawned cohorts.
- After signalling or determining a group is already gone, clear that group's durable record with `clearVerifierProcessGroup(runId, pgid)`; rules out leaving swept ids on the row or whole-run `clearVerifierProcessGroups` after a single sweep signal.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts` proves every recorded group for a non-live run is signalled at daemon start, not just the ready-gate group; it fails against the pre-fix gate-only sweep.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the leaked-`bun test` gotcha states that all four finalization spawns are bound, and drops the reference to the reaped `reap-ready-gate-test-children-on-run-termination` seed; keep diagnostic recipes (attribute by CPU and parentage, not age).
- `v2/docs/daemon-host.md` — document multi-group verifier sweep at daemon start and per-group clear after sweep.
- `v2/docs/v1-behaviors.md` — record daemon-startup reaping of every recorded finalization verifier process group.
