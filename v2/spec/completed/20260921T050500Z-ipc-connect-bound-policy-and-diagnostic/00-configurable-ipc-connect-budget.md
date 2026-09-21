# Make the IPC connection budget configurable and diagnostic

## Problem

`connectIpcClient` privately limits connection establishment to 5000 ms. Loaded hosts cannot extend that bound, and its generic timeout text obscures that the connection budget—not a test or frame-read deadline—expired.

## Decisions

- Add `connectTimeoutMs` as the third `connectIpcClient` argument and retain `defaultTimeoutMs` as the second; rules out silently reinterpreting existing callers' frame-read budgets.
- Default the connection budget to 30000 ms and start it before `socket.connect`; rules out retaining the load-sensitive 5000 ms wall or starting the clock after connection work begins.
- Limit the connection budget to establishment only; rules out applying 30000 ms to `nextFrame()` when its existing default is omitted.
- Report exhaustion as `IPC connect timeout` with the effective `<N>ms` budget; rules out the pre-fix generic socket-timeout diagnostic and omission of the governing value.
- Deferred to first consumer: invalid `connectTimeoutMs` handling (zero, negative, non-finite) — pin when a caller needs it
- Exercise the public client API and existing socket surface in tests; rules out production test hooks or `*ForTest` exports.

## Task checklist

- [ ] Extend `connectIpcClient` and its private connection helper to accept the distinct connection budget with the 30000 ms default.
- [ ] Emit the connection-specific exhaustion diagnostic with the effective budget.
- [ ] Add focused IPC client regressions for the default, exact-default expiry, explicit, and frame-read-unbounded cases without changing frame-read timeout semantics.
- [ ] Update the `connectIpcClient` doc comment to distinguish `defaultTimeoutMs` (frame reads) from `connectTimeoutMs` (connection), and the stale 5-second connect statement in `v2/src/daemon/daemon.ts`.
- [ ] Update the v1 behavior catalog with the new connection-bound contract and diagnostic.

## Acceptance criteria

- [x] `v2/src/ipc/client.test.ts` holds connection completion until 5001 ms, then releases it and connects under the default 30000 ms budget; the regression fails against the pre-fix 5000 ms bound.
- [x] `v2/src/ipc/client.test.ts` holds connection completion past an explicit 10 ms connection budget and observes an `IPC connect timeout` error naming `10ms`; the regression fails against the pre-fix diagnostic.
- [x] `v2/src/ipc/client.test.ts` connects with no `defaultTimeoutMs` and a short explicit `connectTimeoutMs`, parks `nextFrame()` past that budget without its own timeout, then delivers a frame and observes it resolve; the regression fails if the connection budget is applied to frame reads.
- [x] `v2/src/ipc/client.test.ts` shows an omitted connection budget is still pending just before 30000 ms and rejects with `IPC connect timeout` naming `30000ms` after it, so a different default fails; time is controlled per `v2/docs/test-writing.md`.
- [x] `v2/src/ipc/ipc.sandbox-unrunnable.test.ts` parked-unbounded-`nextFrame()` tests stay green, confirming that an omitted frame-read default remains unbounded.
- [x] `v2/docs/v1-behaviors.md` records the 30000 ms default connection budget, the optional caller override, its separation from `nextFrame()`, and the connection-specific exhaustion diagnostic.
- [x] The `connectIpcClient` doc comment in `v2/src/ipc/client.ts` distinguishes the frame-read and connection budgets, and `v2/src/daemon/daemon.ts` no longer states a 5-second connection bound.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the changed IPC connection-bound policy and distinct exhaustion diagnostic.
- `v2/src/ipc/client.ts` — `connectIpcClient` doc comment distinguishes the two optional budgets.
- `v2/src/daemon/daemon.ts` — replace the "5s bound covers connect" statement with the 30000 ms default.
