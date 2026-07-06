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
- "tail stream aborts follow signal on client stream-end" becomes: aborting
  the caller-supplied `AbortSignal` propagates to the `signal` argument
  `logReader.follow` receives (asserted via the existing `onFollow` spy).

## Out of scope

- Converting any other daemon test file.
- Changing `createTailStreamHandler` behavior.

## Documentation updates

None — internal test-infrastructure change, no operator-visible or v1-parity
behavior changes.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-tail-stream.test.ts` no longer imports
      `startIpcServer`, `connectIpcClient`, or `canUseUnixSockets`, and has no
      `SOCKET_PATH`/socket-file `rmSync`.
- [ ] `bun test v2/src/daemon/daemon-tail-stream.test.ts` passes with the same
      number of `test`/`socketTest` cases as before conversion, 0 skipped.
