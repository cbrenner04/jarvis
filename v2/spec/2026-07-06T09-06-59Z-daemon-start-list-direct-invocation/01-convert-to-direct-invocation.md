# 01 - Convert daemon-start-list.test.ts to direct handler invocation

Builds on 00. `daemon-start-list.test.ts` currently reaches `createRunControlHandlers`
only through a real unix-socket `IpcServer` + `IpcClient` round trip, gated on
`canUseUnixSockets()`/`socketTest`. Most of its cases exercise handler logic that doesn't
need the socket at all. Convert those to call the handlers returned by
`createRunControlHandlers` directly; keep a small number of socket round trips to cover
wire (de)serialization.

## Decisions

- Establish the canonical `createFakeWriteLoopExecutor` (with settle/abort/pause
  introspection, per this file's current variant) in `v2/src/testing/`. This becomes the
  shared implementation for future consumers; existing local variants in
  `daemon-queue-promotion.test.ts` and `tui-daemon-client.test.ts` are untouched (out of
  scope, per intent).
- Add new direct-invocation helpers to `v2/src/testing/run-control.ts` (e.g.
  `startRunDirect`/`listRunsDirect`, taking the object `createRunControlHandlers` returns
  and calling `.start`/`.list` directly) alongside the existing `startRun`/`listRuns`,
  which keep their current `IpcClient`-based signature unchanged. `mockWriteLoopInput`
  takes no client and is reused as-is by both direct and socket cases.
- Every case in `daemon-start-list.test.ts` that doesn't specifically test wire behavior
  converts to plain `test` calling handlers directly; drop `SOCKET_PATH`, `rmSync`, and
  `canUseUnixSockets`/`socketTest` gating from those cases.
- Keep exactly 1-2 cases as `socketTest` round trips through a real `IpcServer`/`IpcClient`
  (e.g. "start returns a run ID" and one `list` case) to cover JSON marshaling of
  params/results over the wire.
- No behavior coverage is dropped: every existing assertion keeps an equivalent case after
  conversion.

## Out of scope

- Converting `daemon-queue-promotion.test.ts` or `tui-daemon-client.test.ts` to the shared
  `createFakeWriteLoopExecutor` or to direct invocation.
- Any handler behavior change beyond 00's dependency injection.
- `daemon-queue-promotion.test.ts`'s existing `startRun(client, ...)`/`listRuns(client)`
  calls through `connectIpcClient` are untouched and continue to compile and pass
  unchanged — the existing exported signatures are not repurposed.

## Acceptance criteria

- [x] `v2/src/testing/` exports a canonical `createFakeWriteLoopExecutor` with settle-all,
      abort-all, settle-first, pending-count, pause-signal-triggered, and
      abort-signal-triggered introspection.
- [x] `v2/src/testing/run-control.ts` exports direct-invocation helpers that call
      `createRunControlHandlers` output directly (no `IpcClient`), used by
      `daemon-start-list.test.ts`'s converted cases.
- [x] `startRun`/`listRuns`' existing `IpcClient`-based signatures are unchanged;
      `daemon-queue-promotion.test.ts` compiles and passes unchanged against them.
- [x] `daemon-start-list.test.ts` runs with 0 skips in the agent sandbox.
- [x] `daemon-start-list.test.ts` retains exactly 1-2 `socketTest` cases exercising a real
      `IpcServer`/`IpcClient` round trip; every other case runs as a plain `test` with no
      socket setup.
- [x] Total test count in `daemon-start-list.test.ts` is unchanged from before this
      subspec, aside from the 1-2 cases that stay socket-based.

## Documentation updates

- None — this is test-harness-internal refactoring with no operator-facing or
  production-behavior change beyond 00's already-documented dependency injection.
