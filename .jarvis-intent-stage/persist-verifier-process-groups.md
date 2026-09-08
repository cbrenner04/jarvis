---
name: persist-verifier-process-groups
---

# Persist multiple verifier process groups per run

## Prerequisites

## Primary implementation surface

- Persistence: verifier process-group storage in `v2/src/persistence/state-store.ts`

## Problem

`runs.ready_gate_pgid` holds one integer and `setReadyGatePgid` overwrites it, so a run that records a second verifier group silently drops the first. Finalization runs verifiers in sequence and may hold more than one in-flight group; the existing gate-only column cannot represent that shape.

## Decision ledger

- Durable storage carries multiple process-group ids per run without overwriting earlier recordings; rules out retaining the single `ready_gate_pgid` column as the only store.
- Generalize the existing record/list/clear API used by `setReadyGatePgid` and `listReadyGateSweepCandidates` rather than introducing a parallel reaping mechanism; rules out a second orphan-sweep path.
- Sweep-candidate listing returns every recorded group whose owning run is not live, using the same owner-liveness probe as today; rules out age-based reaping.
- `null` clear semantics remain per recorded group at settlement or after sweep; rules out a separate clear-only API.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` proves one run can carry multiple recorded verifier process groups and that every recorded group is returned as a sweep candidate when the owning run is not live; it fails against single-column storage.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — document multi-group verifier process-group storage, record/clear semantics, and generalized sweep-candidate listing.
