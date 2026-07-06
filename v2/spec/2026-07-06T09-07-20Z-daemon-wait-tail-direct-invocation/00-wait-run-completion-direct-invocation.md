# 00 - Convert daemon-wait-run-completion.test.ts to direct handler invocation

`v2/src/daemon/daemon-wait-run-completion.test.ts` boots a real unix-socket
`IpcServer` + `connectIpcClient` to exercise `createRunControlHandlers`'
`wait`/`list` methods, which are plain injectable functions
(`(frame, signal) => Promise<IpcFrame> | IpcFrame`). Call the returned handler
map directly instead.

## Decisions

- Replace `startIpcServer`/`connectIpcClient` with direct calls into the object
  `createRunControlHandlers(...)` returns: `handlers.wait({ kind: "request", id, method: "wait", params }, signal)`,
  `handlers.list({ kind: "request", id, method: "list" })`.
- Drop `SOCKET_PATH`, the `rmSync` socket-file cleanup, `canUseUnixSockets`,
  and `socketTest` — no socket file exists to leak or gate on.
- Keep `openStateStore`/`openLogSink`/`openLogReader` against real temp-file
  paths (SQLite + JSONL) — only the IPC transport is removed, not the
  persistence layer under test.
- "pending wait does not block other RPCs on the same connection" and
  "disconnecting one wait client leaves other waiters ... alone" test
  transport-level concurrency/disconnect semantics that don't exist without a
  socket. Rewrite them as: two `wait()` calls against the same `runId` resolve
  independently (fanout), and one caller's `AbortSignal` abort detaches only
  that waiter, leaving the other pending and the durable status untouched.

## Out of scope

- Converting `daemon-start-list.test.ts` or any other daemon test file.
- Changing `createRunControlHandlers` or `WaitFanout` behavior.

## Documentation updates

None — internal test-infrastructure change, no operator-visible or v1-parity
behavior changes.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-wait-run-completion.test.ts` no longer imports
      `startIpcServer`, `connectIpcClient`, or `canUseUnixSockets`, and has no
      `SOCKET_PATH`/socket-file `rmSync`.
- [ ] `bun test v2/src/daemon/daemon-wait-run-completion.test.ts` passes with
      the same number of `test`/`socketTest` cases as before conversion, 0
      skipped.
