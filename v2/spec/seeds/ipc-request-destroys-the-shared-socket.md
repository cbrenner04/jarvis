---
name: ipc-request-destroys-the-shared-socket
---

# A second RPC on one IPC client always fails — `request()` destroys the socket after every call

**Fixed in passing by #1558; this seed exists for the test-coverage hole that let it ship, and to
record the class.** Read it before adding any CLI path that issues more than one RPC.

`v2/src/cli.ts`'s `request()` helper was:

```ts
async function request(client: IpcClient, method: string, params?: unknown): Promise<unknown> {
  const transport = createRpcTransport(client);
  try {
    return await transport.request(method, params);
  } finally {
    transport.close();          // -> client.close() -> socket.destroy()
  }
}
```

`RpcTransport.close()` calls `client.close()` (`v2/src/ipc/rpc-transport.ts:159`), and the real
`IpcClient.close()` is `socket.destroy()` (`v2/src/ipc/client.ts:121`). So **every** `request()`
tore down the connection it was handed. That is invisible while each CLI path issues exactly one
RPC per `withRunClient` — which was true of every path until now.

`run-workflow-exit-status-tracks-run-outcome` made `run workflow` issue `start` and then `wait` on
one client. Against a real daemon it printed the run id, then died `IPC connection lost`, exit 1 —
every invocation. The 16 red `cli.test.ts` tests were correct and were nearly dismissed as stale
fixtures.

This directly contradicts the transport's own contract, which is documented as *"Multiplex
correlated IPC requests on one transport"* — a transport built for many requests, closed after one.

## Decisions

- A test asserts that two sequential RPCs on one `IpcClient` both succeed, driven through
  `withRunClient` against a fake daemon that holds the socket open. Rules out the regression
  reappearing the next time someone adds a second call. **This is the point of the seed** — the fix
  landed without it.
- `request()` never owns connection lifetime; the scope that opened the client (`withRunClient`)
  closes it. Rules out per-call teardown of a shared resource.
- `IpcClient.close()` being `socket.destroy()` stays; the bug was the caller, not the primitive.
- Rules out: guarding by re-opening a socket per request. That serializes and re-connects on every
  RPC, and hides the ownership error instead of fixing it.

## Prerequisites

- None. #1558 shipped the fix (memoize one transport per client in a `WeakMap`).

## Out of scope

- The daemon-side `wait` handler.
- `run log`'s streaming path, which talks to the client directly and never used `request()`.

## Documentation updates

- `v2/docs/daemon-host.md` — connection lifetime: who opens a client, who closes it, and that a
  client may carry several correlated requests.
