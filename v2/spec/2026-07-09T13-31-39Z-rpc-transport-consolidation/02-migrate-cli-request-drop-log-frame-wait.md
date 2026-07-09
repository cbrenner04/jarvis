# 02 - Migrate cli.ts request() and drop LOG_FRAME_WAIT_MS

## Problem

`cli.ts`'s module-local `request()` (used by `run start`, `run workflow
implement`, `run list`, `run pause|resume|kill`, `run wait`) hand-rolls its
own correlated request/reply loop instead of using the transport relocated in
subspec 00. Separately, `run log`'s stream-follow loop bounds its
`nextFrame` calls with `LOG_FRAME_WAIT_MS = 86_400_000` (24h) — a workaround
invented for that ad-hoc loop, not a requirement of RPC framing. `ipc/
client.ts` already documents `nextFrame()` (no argument) as legitimately
unbounded for exactly this kind of long-running production wait; `run log`
should just use that instead of a magic 24h constant.

## Decisions

- `request(client, method, params)` becomes a thin wrapper: build a
  `createRpcTransport(client)` and call `transport.request(method, params)`,
  returning `unknown` on success or throwing `RpcError`/`RpcConnectionError`
  on failure — replaces the hand-rolled `send` + `while (true) { nextFrame()
  }` id-matching loop.
- Every call site of the old `request()` (`start`, `workflow implement`,
  `list`, `pause`/`resume`/`kill`, `wait`) moves its `response.kind ===
  "error"` branch to a `try { ... } catch (error) { if (error instanceof
  RpcError) { ...formatRpcError(error)... } throw error; }` — connection-level
  errors (`RpcConnectionError`, or any non-RPC failure) propagate up to
  `withRunClient`'s existing catch/`formatConnectionError`, unchanged.
- `formatRpcError` takes an `RpcError` (`.code`, `.message`) instead of an
  `ErrorFrame`; output format (`` `${code}: ${message}\n` ``) is unchanged.
- `LOG_FRAME_WAIT_MS` is deleted; `run log`'s stream loop calls
  `client.nextFrame()` with no timeout.
- `run log` keeps its own stream-open/stream-data/stream-end loop as-is
  (unbounded `nextFrame()`, no transport wrapping) — it is not a correlated
  RPC request/reply and is out of scope for this consolidation.

## Task checklist

- [ ] Rewrite `request()` in `cli.ts` to use `createRpcTransport`.
- [ ] Update `run start`, `run workflow implement`, `run list`, `run
      pause|resume|kill`, `run wait` call sites to catch `RpcError` instead of
      branching on `response.kind`.
- [ ] Update `formatRpcError` to accept `RpcError`.
- [ ] Delete `LOG_FRAME_WAIT_MS` and the `client.nextFrame(LOG_FRAME_WAIT_MS)`
      call in `run log`; use `client.nextFrame()`.

## Acceptance criteria

- [ ] `cli.test.ts` stays green (all `run start`/`workflow implement`/`list`/
      `pause`/`resume`/`kill`/`wait`/`log` cases, including RPC-error-frame
      and daemon-response cases, exercise the same observable stdout/stderr/
      exit-code behavior).
- [ ] `cli.ts` contains no `LOG_FRAME_WAIT_MS` symbol.
- [ ] `cli.ts`'s `request()` contains no hand-rolled `while (true)` frame loop.

## Documentation updates

None — CLI stdout/stderr/exit-code contracts are unchanged; internal
implementation detail only.
