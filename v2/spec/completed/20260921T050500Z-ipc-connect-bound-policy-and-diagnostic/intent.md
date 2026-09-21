---
name: ipc-connect-bound-policy-and-diagnostic
---

# Make the IPC connect bound load-capable and self-identifying

## Module-boundary surface

- IPC client connection establishment in `v2/src/ipc/client.ts`.

## Problem

IPC connection establishment has a flat private 5000 ms bound. Callers cannot accommodate a loaded host, and exhaustion looks like an unrelated test timeout.

## Behavior

- `connectIpcClient(socketPath, defaultTimeoutMs?, connectTimeoutMs?)` keeps the existing `nextFrame()` argument and accepts an optional connection budget; omitted budgets use a 30000 ms default.
- The connection budget starts before the socket connect and does not bound `nextFrame()`; `nextFrame()` remains unbounded when its existing default is omitted.
- Exhaustion reports `IPC connect timeout` and the effective millisecond budget.

## Acceptance criteria

- [ ] An IPC client regression holds connection completion until 5001 ms, then releases it, and proves the default 30000 ms connection budget permits the client to connect; it fails against the pre-fix 5000 ms bound.
- [ ] An IPC client regression holds connection completion past an explicit 10 ms connection budget and asserts an `IPC connect timeout` error that names `10ms`; it fails against the pre-fix diagnostic.
- [ ] `v2/src/ipc/ipc.sandbox-unrunnable.test.ts` parked-unbounded-`nextFrame()` tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the changed IPC connection-bound policy and distinct exhaustion diagnostic.

## Prerequisites
