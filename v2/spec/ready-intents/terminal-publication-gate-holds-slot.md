---
name: terminal-publication-gate-holds-slot
---

# Terminal publication ready gate holds the shared gate slot

## Problem

Terminal publication invokes the ready gate subprocess without the daemon gate lease, so it can overlap agent or finalization full-suite runs in the same process.

## Decisions

- The terminal-publication ready gate path awaits the gate invocation lease before spawn and releases in `finally`, including on a red gate outcome; rules out scoped verifier or probe runs taking the slot (unchanged).

## Acceptance criteria

- [ ] `v2/src/execution/terminal-publication.test.ts` proves the terminal-publication ready gate acquires and releases the lease, including when the gate fails; fails against pre-fix code that spawns without a lease (reachable on main today).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — terminal-publication ready gate participates in the same per-daemon full-suite slot as agent and finalization gates.
- `v2/docs/v1-behaviors.md` — record terminal-publication gate slot hold.

## Prerequisites

- Gate invocation lease accounting lives in `v2/src/execution/gate-invocation-lease.ts` with refuse acquire, live-lease counting, and release subscriptions consumed by the write loop and daemon slot redrive.
- `awaitGateInvocationLease` queues waiters in FIFO order and returns an owned releasable lease when the slot frees, with abort and timeout rejection.
