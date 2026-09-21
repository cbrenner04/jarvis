---
name: ipc-connect-bound-policy-and-diagnostic
---

# Make the IPC connect bound load-capable and self-identifying

## Module-boundary surface

- IPC client connection establishment in `v2/src/ipc/client.ts`.

## Problem

IPC connection establishment has a flat private 5000 ms bound. Callers cannot accommodate a loaded host, and exhaustion looks like an unrelated test timeout.

## Behavior

- Settle on evidence whether callers can supply the connect budget or the client applies a load-aware policy, and expose the effective policy without changing `nextFrame()` defaults.
- Exhaustion reports an IPC connect timeout and its effective millisecond budget.

## Acceptance criteria

- [ ] An IPC client regression forces connection establishment past its effective bound and asserts an error naming the IPC connect timeout and budget; it fails against the pre-fix diagnostic.
- [ ] A regression proves the settled connect policy can exceed the current flat 5000 ms wall under load; it fails against the pre-fix private constant.
- [ ] Existing unbounded-default `nextFrame()` tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the changed IPC connection-bound policy and distinct exhaustion diagnostic.

## Prerequisites
