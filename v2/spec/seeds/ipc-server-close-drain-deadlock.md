---
name: ipc-server-close-drain-deadlock
---

# IPC server close() self-deadlocks; drain is unreachable dead code

`IpcServer.close()` (`v2/src/ipc/server.ts`) nests the forced socket-drain **inside**
`net.Server.close(cb)`'s callback. But Node/Bun fire that callback **only after all existing
connections have already ended** — `server.close()` does not destroy established sockets. So when
a client connection is still open, the callback never fires, `waitForSocketDrain` (which would
destroy the lingering socket and *cause* the connection to end) never runs, and `close()` hangs
forever. The drain that exists to handle lingering sockets is unreachable in exactly the case it
was written for.

This is the true root cause of the intermittent `Test (v2)` CI stall (reproduced deterministically
on the operator host: `IpcServer.close()` with an open connection never returns). A socket test that
reaches `afterEach` with a connection still open (a throw before its own client teardown, or a
`--parallel` timing race) hits `await server.close()`, which deadlocks; Bun's 30s hook timeout fires
per stall, stalls accumulate across the file, and the run exceeds the 300s `AGENT_MODE_TIMEOUT_MS`
SIGKILL in `scripts/run-v2-tests.ts` → `error: v2 "agent" test run timed out or was killed`. The
already-merged client-side close-reject (`client.ts`, PR #1143) is complementary but insufficient —
it waits for a `'close'` that the deadlocked server never emits.

## Decisions

- **Primary (`v2/src/ipc/server.ts`, load-bearing):** run the forced `waitForSocketDrain` **concurrently
  with** `server.close`, not inside its callback. Destroying lingering sockets is what causes their
  connections to end and `server.close`'s callback to fire. Shape:

  ```
  return new Promise((resolve, reject) => {
    server.close((err) => { rmSync(socketPath, { force: true }); err ? reject(err) : resolve(); });
    void waitForSocketDrain(activeSockets, drainTimeoutMs); // concurrent: destroys lingering sockets
  });
  ```

  `close()` must resolve within `drainTimeoutMs` when a connection is still open, instead of hanging.

- **Client robustness (`v2/src/ipc/client.ts`):** also settle a parked `nextFrame()` read on `'end'`
  and `'error'`, and add the currently-missing `socket.on("error", …)` handler (flagged as out-of-scope
  in PR #1143's review). A daemon connection reset (RST → `'error'`, no clean `'close'`) must reject a
  parked read with a connection error, not hang; an unhandled socket `'error'` must not crash. This must
  **not** break long-quiet tailing — settle only on real disconnect, never on mere silence.

- **Test hygiene (`v2/src/tui/tui-log-tail-client.test.ts`):** the `afterEach` must destroy the client
  socket / abort the tail iterator before `server.close()`, so a thrown assertion can't leak an open
  connection into teardown. Defense-in-depth; the server fix is what makes it safe regardless.

## Tests

- A `server.ts` unit/integration test: open a real client connection, call `IpcServer.close()`, assert
  it resolves within `drainTimeoutMs` (the lingering socket is force-destroyed) rather than hanging.
- A `client.ts` test: parked unbounded `nextFrame()` rejects on socket `'end'` and on `'error'` (in
  addition to the existing `'close'` case), and a socket `'error'` does not go unhandled.
- Existing `ipc.test.ts`, `daemon-start-list.test.ts`, `tui-log-tail-client.test.ts` stay green.

## Out of scope

- Raising `AGENT_MODE_TIMEOUT_MS` or any test-timeout tuning (the fix removes the hang; the threshold
  is fine — normal runtime is 3-4s).
- IPC protocol/framing changes.

## Documentation updates

- `v2/docs/v1-behaviors.md` / `v2/docs/daemon-host.md` if either documents `IpcServer.close()` drain
  semantics — note that close now force-drains lingering sockets concurrently and resolves within
  `drainTimeoutMs`.
