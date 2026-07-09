# 01 - Migrate daemon-lifecycle socket probe

## Problem

`daemon-lifecycle.ts` hand-rolls two RPC-shaped loops instead of using the
relocated transport from subspec 00: `probeSocket` (`send` a `health`
request, then `nextFrame(timeoutMs)` and check `frame.id === "probe"`) and
`stopDaemon`'s shutdown wait (`send` a `shutdown` request, `nextFrame` with a
drain timeout, swallow the error). Both are exactly the request/reply
correlation the shared transport already does, plus (once subspec 00 lands)
timeout support.

## Decisions

- `probeSocket` builds an `IpcClient`, wraps it with `createRpcTransport`, and
  calls `request("health", undefined, { timeoutMs })` instead of hand-rolling
  send + `nextFrame(timeoutMs)` + id comparison; a timeout or any transport
  error is caught and treated as `false`, matching current behavior.
- `stopDaemon`'s shutdown wait uses the same transport's `request("shutdown",
  undefined, { timeoutMs: drainTimeoutMs })`, catching timeout/errors and
  falling through to process-side termination exactly as today — no observable
  change to `stopDaemon`'s fallback-to-kill behavior.
- No change to `startDaemon`/`stopDaemon`/`getDaemonStatus` public signatures,
  the `SocketProber`/`ProcessProber` injection seams, or default timeout
  values.

## Task checklist

- [ ] Rewrite `probeSocket` to use `createRpcTransport`.
- [ ] Rewrite the `stopDaemon` shutdown-wait step to use `createRpcTransport`.
- [ ] Remove the now-unused manual `client.send` + `client.nextFrame` +
      id-comparison code in `daemon-lifecycle.ts`.

## Acceptance criteria

- [ ] `daemon-lifecycle.test.ts` stays green (behavior unchanged; all cases
      inject `socketProber`/`processProber`, so the rewrite is exercised only
      through those same seams — no test changes expected).
- [ ] `daemon-lifecycle.ts` contains no direct `client.nextFrame(...)` call
      guarded by manual id comparison for `health` or `shutdown`.

## Documentation updates

None — internal implementation detail, no operator-facing or documented
behavior change.
