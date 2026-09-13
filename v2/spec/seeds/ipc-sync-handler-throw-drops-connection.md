---
name: ipc-sync-handler-throw-drops-connection
---

# A synchronous throw inside an IPC RPC handler drops the connection instead of answering `internal_error`

## Problem

`dispatchRequest` (`v2/src/ipc/server.ts`) calls `customHandler(frame, signal)` *before* wrapping the result in `Promise.resolve(...)`, so only a rejected promise reaches the `.catch` that writes an `internal_error` frame. A handler that throws synchronously escapes `dispatchRequest` and `handleFrame` into the socket `data` listener's bare `catch`, which exists to reject malformed frames and does `socket.destroy()`. The client sees `connection closed` with no reply and no code, indistinguishable from the daemon dying.

Sync throws are reachable from production handlers: `start` resolves the machine profile on the way to its memory-headroom check (`daemon-run-control-context.ts`), and `resolveMachineProfile` throws on a missing or malformed `config.json`. The daemon stays up and healthy; only the request that hit the throw loses its socket.

## Evidence (2026-09-12)

Diagnosed while hand-finishing #3824. A spawned daemon whose `JARVIS_HOME` had no `config.json` answered `health` normally and ended every `start` connection with zero bytes:

```text
END (server ended)
CLOSE hadErr false total bytes 0
ZZDEBUG handleFrame threw: error: Machine config at <home>/config.json is missing required 'machineProfile' key
      at resolveMachineProfile (v2/src/config/machine-config-loader.ts:310:15)
      at handleWriteLoopStart (v2/src/daemon/daemon-run-lifecycle-handlers.ts:553:10)
      at dispatchRequest (v2/src/ipc/server.ts:57:21)
```

Cost: the failure read as a handoff-protocol defect (the test was the lifecycle criterion for the handoff subspec) and the PR shipped as a draft for a session before the cause was found.

## Decisions

- A handler's synchronous throw is answered exactly like a rejection: `internal_error` with the error message, connection kept open. Rules out treating a handler bug as a framing violation.
- `socket.destroy()` in the `data` listener stays reserved for decode failures; handler dispatch cannot reach it. Rules out widening the destroy path.
- No change to handler contracts: handlers may keep throwing; the seam absorbs both shapes. Rules out auditing every handler for sync-vs-async error style.

## Acceptance criteria

- [ ] A test proves a handler that throws synchronously yields an `internal_error` frame carrying the message and leaves the connection open for a following request; it fails against the current dispatch.
- [ ] A test proves a malformed frame still destroys the socket (the decode path is unchanged).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — IPC error contract: handler failures of either shape answer `internal_error`; only framing violations close the connection.
