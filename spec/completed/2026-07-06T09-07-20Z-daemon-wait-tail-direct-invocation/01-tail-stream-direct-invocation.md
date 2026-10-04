# 01 - Convert daemon-tail-stream.test.ts to direct handler invocation

`v2/src/daemon/daemon-tail-stream.test.ts` boots a real unix-socket
`IpcServer` to exercise `createTailStreamHandler`'s returned `StreamHandler`
(`(streamId, payload, onData, onClose, signal) => Promise<void>`), a plain
injectable function. Call it directly instead.

## Decisions

- Replace `startIpcServer`/`connectIpcClient`/`stream-open`/`stream-end`
  frames with a direct call: `tailHandler(streamId, payload, onData, onClose, signal)`,
  collecting `onData` records into an array and using an `AbortController` in
  place of client-side `stream-end`.
- Drop `SOCKET_PATH`, its `rmSync`, `canUseUnixSockets`, and `socketTest` — no
  socket file exists to leak or gate on. `LOGS_PATH` stays (real JSONL file
  under test).
- Keep `openStateStore`/`openLogSink`/`openLogReader` against real temp-file
  paths — only the IPC transport is removed.
- Signal convention (applies to every `tailHandler` call in this file): each
  test constructs its own `new AbortController()` and passes `.signal` as
  `tailHandler`'s fifth argument; only a test that exercises abort behavior
  calls `.abort()` on that controller.
- Resolution mechanics split into two categories, per `createTailStreamHandler`
  (`v2/src/daemon/daemon.ts`): guard paths (`!params?.runId`, non-string
  `runId`, unknown `runId` per `stateStore.loadRun`) call `onClose()` and
  `return` synchronously without ever calling `logReader.follow`; the tests
  hitting those paths — "closes without stream-data for missing runId",
  "...for non-string runId", "...for unknown runId" (all via
  `expectTailClosesWithoutData`) — can `await tailHandler(...)` directly with
  no abort needed, since the returned promise settles on its own.
- Follow-path tests call `logReader.follow`, whose loop only exits when its
  `signal` is aborted (`v2/src/persistence/log-stream.ts` `follow`) — it does
  not resolve on its own once persisted records are exhausted. Both
  follow-path tests — "replays persisted events in seq order for known run"
  and "aborts follow signal on client stream-end" — must call `tailHandler(...)`
  without awaiting it yet, drive assertions off the `onData` array as records
  arrive, then call the per-test `AbortController`'s `.abort()` once the
  expected records have been observed, and only then `await` the handler
  promise and assert `onClose` fired exactly once.
- "tail stream aborts follow signal on client stream-end" becomes: aborting
  the caller-supplied `AbortSignal` propagates to the `signal` argument
  `logReader.follow` receives (asserted via the existing `onFollow` spy), then
  the awaited handler promise resolves and `onClose` fires once.

## Out of scope

- Converting any other daemon test file.
- Changing `createTailStreamHandler` behavior.

## Documentation updates

None — internal test-infrastructure change, no operator-visible or v1-parity
behavior changes.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-tail-stream.test.ts` no longer imports
      `startIpcServer`, `connectIpcClient`, or `canUseUnixSockets`, and has no
      `SOCKET_PATH`/socket-file `rmSync`.
- [x] `bun test v2/src/daemon/daemon-tail-stream.test.ts` passes with the same
      number of `test`/`socketTest` cases as before conversion, 0 skipped.
- [x] The converted file still asserts, each in some test: persisted events
      replay via `onData` in ascending `seq` order for a known run; the
      missing/non-string/unknown-`runId` guard paths close via `onClose`
      without any `onData` call and without invoking `logReader.follow`;
      aborting the caller's `AbortSignal` propagates to the `signal` argument
      `logReader.follow` receives; and `onClose` fires exactly once per call
      in every case.
