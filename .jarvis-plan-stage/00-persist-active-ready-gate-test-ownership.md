# Persist active ready-gate test ownership

## Problem

Ready-gate test process groups have no durable run ownership, so a daemon that did not spawn them cannot safely distinguish an active or leaked group from an unrelated reused process identity.

## Decision ledger

- Keep one active ownership record per run, replacing it when that run registers a retry or resumed invocation. Rules out accumulating stale invocations that a later consumer could mistake for concurrent live groups.
- Persist the owning run ID, an invocation fence, the process-group ID, and the group leader's `<pid>:<process-start-epoch>` identity. Rules out a bare PID or process-group ID that cannot detect reuse.
- Compare the run ID and invocation fence when clearing, and refuse a stale clear without changing the replacement record. Rules out an older completion clearing a newer retry or resume.
- Expose ownership records as evidence only; process-identity validation and signaling remain consumer responsibilities. Rules out adding ready-gate execution or daemon-reaping policy to the state store.

## Tasks

- Add a forward-only state-store migration for active ready-gate test ownership tied to durable runs.
- Add typed state-store operations to register or replace one run's active record, enumerate active records, and compare-and-clear one invocation.
- Cover round-trip, reopen, pre-migration upgrade, replacement, stale-clear refusal, and run-state isolation in `v2/src/persistence/state-store.test.ts`.

## Acceptance criteria

- [ ] The state store registers or replaces one active ready-gate test ownership record per run and enumerates records containing the run ID, invocation fence, process-group ID, and group-leader process identity.
- [ ] `v2/src/persistence/state-store.test.ts` — `persists active ready-gate test ownership across reopen`; Keystone checkpoint: the test fails against the pre-change store, proves round-trip and reopen durability, and includes an in-test `// @mutate` that removes durable registration so the scoped suite fails.
- [ ] A database containing every pre-change migration opens successfully, gains the ownership schema, and can register and enumerate a record without rewriting existing run lifecycle or ready-gate repair fields.
- [ ] `v2/src/persistence/state-store.test.ts` — `clears only the matching ready-gate invocation`; Mutation checkpoint: the test replaces one run's older invocation with a newer invocation, proves the older compare-and-clear is refused without removing the newer record, and includes an in-test `// @mutate` that weakens the exact-invocation predicate so the scoped suite fails.
- [ ] Registering, enumerating, replacing, or clearing ownership leaves the owning run's lifecycle status and ready-gate repair fence unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — this is an internal persistence contract; ready-gate execution, daemon recovery, and operator semantics belong to later consumers.
