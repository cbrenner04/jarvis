---
name: persist-ready-gate-test-process-ownership
---

# Persist ready-gate test process ownership

## Surface

- Persistence.

## Problem

Ready-gate test process groups have no durable run ownership, so a daemon that did not spawn them cannot safely distinguish leaked test descendants from live or PID-reused processes.

## Decision ledger

- Persist each active ready-gate test process group with its owning run and verifiable process identity before the test invocation proceeds. Rules out an in-memory registry or run-status inference that cannot survive daemon loss or identify descendants.
- Compare-and-clear the exact registered invocation after its process group settles. Rules out an older gate attempt clearing a newer retry or resume record for the same run.
- Require identity validation before a record can authorize signaling its process group. Rules out killing an unrelated process after PID or process-group reuse.
- Keep run status, ready-gate selection, command order, and healthy gate execution unchanged. Rules out coupling ownership persistence to gate policy.

## Acceptance criteria

- [ ] A forward-only v2 state-store migration and typed API register, enumerate, and compare-and-clear active ready-gate test process-group ownership, including run identity and enough process identity to reject PID or process-group reuse.
- [ ] `v2/src/persistence/state-store.test.ts` — `persists active ready-gate test ownership across reopen` fails against the baseline, then proves an ownership record round-trips, survives store reopen, and a pre-change database migrates.
- [ ] `v2/src/persistence/state-store.test.ts` — `clears only the matching ready-gate invocation`; Mutation checkpoint: weakening the exact-invocation guard lets an older completion clear a newer retry record and makes the scoped regression fail.
- [ ] Ownership persistence does not mutate the owning run's lifecycle status or existing ready-gate repair state.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — this intent adds an internal persistence contract; operator and daemon-host semantics belong to its consumers.

## Prerequisites
