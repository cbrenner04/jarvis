# Remove dead transport-level health/status fallback

## Problem

`dispatchRequest` in `v2/src/ipc/server.ts` hardcodes `health`/`status`
responses in its `switch (method)` fallback, reached only when
`handlers?.[method]` is undefined. The daemon (`v2/src/daemon/daemon.ts`)
always registers `health`/`status` handlers, so this fallback never runs in
production — it only fires in tests that start a bare `IpcServer` with no
handlers.

## Decisions

- Delete the `case "health"` / `case "status"` branches; unmatched methods
  fall through to the existing `default` (`unknown_method` error) — rules out
  keeping the branches as an unreachable safety net.
- `v2/src/ipc/ipc.test.ts` currently starts `startIpcServer(SOCKET_PATH)`
  with no handlers and asserts on the transport fallback's `health`/`status`
  responses. Update `beforeEach` to pass stub `health`/`status` handlers that
  return the exact payloads the deleted fallback returned — `health` →
  `{ ok: true }`, `status` → `{ state: "running" }` — so existing assertions
  require no changes beyond dispatch wiring, and these tests keep exercising
  real handler dispatch through the transport — rules out deleting the tests
  outright (they also cover multi-client dispatch and post-malformed-client
  server liveness, not just the health/status payloads) and rules out
  inventing different stub payloads that would silently mask a behavior
  change.

## Task Checklist

- [ ] Delete the `case "health"` and `case "status"` branches from
      `dispatchRequest` in `v2/src/ipc/server.ts`.
- [ ] Pass stub `health`/`status` handlers into `startIpcServer` in
      `v2/src/ipc/ipc.test.ts`'s `beforeEach`, returning `{ ok: true }` and
      `{ state: "running" }` respectively, so existing assertions on
      `health`/`status` responses keep passing through real handler dispatch
      unchanged.
- [ ] Update `v2/docs/v1-behaviors.md` per the Documentation updates section.

## Documentation updates

- Add a `v2/docs/v1-behaviors.md` entry noting that unmatched IPC methods
  (including `health`/`status` when no handler is registered) always return
  `unknown_method`; the transport no longer has a built-in `health`/`status`
  fallback, and daemon-registered handlers are the only source of those
  responses.

## Acceptance criteria

- [x] `v2/src/ipc/server.ts` `dispatchRequest` has no `case "health"` or
      `case "status"` branches; an IPC server started without a `health`
      handler responds to a `health` request with `unknown_method`.
- [x] An IPC server started without a `status` handler responds to a
      `status` request with `unknown_method`.
- [x] `v2/src/ipc/ipc.test.ts` passes with `bun test v2/src/ipc/ipc.test.ts`.
- [x] `v2/docs/v1-behaviors.md` documents the current `health`/`status`
      dispatch behavior (daemon-handler-only, no transport fallback).
