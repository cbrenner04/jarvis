---
name: finalization-ready-gates-share-the-gate-slot
---

# Harness finalization gates share the one-per-daemon gate slot

Unsplit rationale: four strictly chained parts over the same lease and finalization path; one spec with ordered subspecs (part order below) instead of a serial fan-out.

## Problem

The one-per-daemon full-suite gate slot (`write-loop.ts`) is acquired only by agent-invoked gates. Harness finalization gates (default ready gate, required integration, repair re-gates, terminal-publication gate) spawn without it, so concurrent lane publications run several full suites at once and false-red on load (2026-10-01: runs ed378400, 621a823b, ad2cabe2, ba7bc222, d7decbed all `ready_gate_failed` on per-file timeouts outside their diffs).

## Part 0: Lease module with FIFO waiting acquire

### Decisions

- Move `acquireGateInvocationLease`, live-lease counting, release subscriptions, `gateInvocationAdmits`, and `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` to `v2/src/execution/gate-invocation-lease.ts`; `write-loop.ts` and `daemon-slot-redrive.ts` import them with no agent gate behavior change.
- Add `awaitGateInvocationLease({ signal, timeoutMs })`: FIFO queue, resolves with an owned lease on release; abort rejects without corrupting the queue; `timeoutMs` expiry rejects; rules out applying this API to agent gates (they keep refuse-only acquire).

### Acceptance criteria

- [ ] `v2/src/execution/gate-invocation-lease.test.ts` proves two concurrent `awaitGateInvocationLease` calls resolve in FIFO order and the second runs only after the first releases; an aborted waiter rejects and leaves the queue intact; a waiter exceeding `timeoutMs` rejects; the suite fails against a refuse-only lease without waiting acquire (reachable on main today).
- [ ] `write-loop.test.ts` gate-invocation refusal and lease-cap tests stay green (agent refuse-on-contention unchanged by the extraction).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Part 1: Finalization gates wait for the slot

### Decisions

- Default ready gate, required integration, and each repair re-gate in `publishCompletionArtifacts` await `awaitGateInvocationLease` before spawn, release in `finally`, and re-acquire on each repair re-gate after the repair agent releases the prior hold; base-ref probes and scoped verifier runs stay outside the slot.
- Wait is bounded by `readyGateSubprocessTimeoutMs()` and aborted by the run signal; wait time does not consume the gate subprocess deadline (armed at spawn). Expiry throws `ReadyGateError` with `timedOut: true` and output naming the slot wait; rules out a new failure kind.
- When acquire did not resolve immediately, log `ready_gate_slot_wait` with `gate` and `waitedMs`; while queued, `jarvis run list` `message` shows `waiting for gate slot`.

### Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` proves two concurrent `createReadyFinalizer` runs over a stubbed `asyncSubprocessRunner` never overlap gate spawns (max in-flight 1), required integration holds the lease, a held agent lease delays the finalization gate until released, and each repair re-gate re-acquires the slot after the repair agent releases the prior lease before spawn; fails against pre-fix code with unleased harness spawns (reachable on main today).
- [ ] `v2/src/execution/ready-finalize.test.ts` proves a non-immediate slot acquire logs `ready_gate_slot_wait` with `gate` and `waitedMs`; fails against pre-fix code with no slot wait logging (reachable on main today).
- [ ] `v2/src/commands/run.test.ts` proves `jarvis run list` `message` shows `waiting for gate slot` while finalization is queued on the slot; fails against pre-fix code with no slot-wait message (reachable on main today).
- [ ] `v2/src/execution/ready-finalize.test.ts` proves slot-wait expiry surfaces `ReadyGateError` with `timedOut: true` naming the slot wait; fails against pre-fix code with no slot wait (reachable on main today).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Part 2: Terminal-publication gate holds the slot

### Decisions

- The terminal-publication ready gate path awaits the gate invocation lease before spawn and releases in `finally`, including on a red gate outcome; rules out scoped verifier or probe runs taking the slot (unchanged).

### Acceptance criteria

- [ ] `v2/src/execution/terminal-publication.test.ts` proves the terminal-publication ready gate acquires and releases the lease, including when the gate fails; fails against pre-fix code that spawns without a lease (reachable on main today).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Part 3: Finalization releases re-drive refused agent gates

### Decisions

- No coordinator logic change beyond releases from harness-held leases firing the existing release subscription; agent gates refused during a held finalization lease still settle `slot_contention` and re-drive on release as today.

### Acceptance criteria

- [ ] `v2/src/daemon/daemon-slot-redrive.test.ts` proves a finalization-lease release triggers the `slot_contention` automatic re-drive path; fails against pre-fix code where finalization spawns without a lease (reachable on main today).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Concurrency — slot covers harness finalization gates; finalization waits while agents refuse; document `ready_gate_slot_wait` and `waiting for gate slot`.
- `v2/docs/write-behavior.md` — finalization gate serialization and repair re-acquire on the shared slot.
- `v2/docs/v1-behaviors.md` — record harness finalization sharing the daemon gate slot.
- `v2/docs/write-behavior.md` — terminal-publication ready gate participates in the same per-daemon full-suite slot as agent and finalization gates.
- `v2/docs/v1-behaviors.md` — record terminal-publication gate slot hold.
- `v2/docs/write-behavior.md` — note that finalization and terminal gate releases participate in the same redrive wakeups as agent gate releases (cross-link operator-runbook § Concurrency if not already updated by the finalization intent).

## Prerequisites

None.
