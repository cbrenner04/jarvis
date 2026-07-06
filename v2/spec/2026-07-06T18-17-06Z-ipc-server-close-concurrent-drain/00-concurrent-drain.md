# Run forced drain concurrently with server.close

## Problem

`IpcServer.close()` (`v2/src/ipc/server.ts`) nests the forced `waitForSocketDrain`
inside `net.Server.close(cb)`'s callback. That callback only fires after all
existing connections have already ended, and `server.close()` does not itself
destroy established sockets. With a client connection still open, the callback
never fires, the drain never starts, and `close()` hangs forever.

## Decisions

- Start `waitForSocketDrain` concurrently with `server.close`, not nested in its
  callback — destroying a lingering socket is what causes its connection to end
  and the callback to fire.
- `close()` resolves once both the server-close callback and the drain have
  settled (`Promise.all`), so socket removal (`rmSync`) still happens after
  both finish.
- Errors from either branch propagate to the caller of `close()` — do not
  swallow `server.close` errors, matching prior behavior.

## Acceptance criteria

- [ ] `IpcServer.close()`, constructed with an explicit short test
      `drainTimeoutMs` (not the production default), resolves within that
      timeout while a client connection is still open (lingering socket is
      force-destroyed), instead of hanging.
- [ ] `v2/src/ipc/ipc.test.ts` stays green.
- [ ] `v2/src/daemon/daemon-start-list.test.ts` stays green.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md`: add a `[v2 additive]` entry noting
      `IpcServer.close()` force-drains lingering sockets concurrently with
      `server.close` and resolves within `drainTimeoutMs` rather than waiting
      on the close callback.
