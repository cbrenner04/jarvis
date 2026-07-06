# Convert daemon-queue-promotion.test.ts to direct invocation

`v2/src/daemon/daemon-queue-promotion.test.ts` boots a real unix-socket `IpcServer`
+ SQLite `StateStore` for every socket-gated test, with a local copy of
`createFakeWriteLoopExecutor`, to reach `createRunControlHandlers`. Convert the
socket-gated tests to call the handlers directly.

## Decisions

- Replace `startIpcServer`/`connectIpcClient`/`toIpcHandlers` usage with direct
  calls against the object returned by `createRunControlHandlers`, via
  `startRunDirect`/`listRunsDirect` from `v2/src/testing/run-control.ts`. This
  includes the test that constructs `startIpcServer` inline outside the
  `startHandlers` wrapper — every socket call site in the file converts, not
  just the wrapper path.
- Drop `SOCKET_PATH`, `rmSync` on the socket path, `canUseUnixSockets`, and
  `socketTest` — every test in this file runs unconditionally.
- Drop the file's local `createFakeWriteLoopExecutor`/`FakeWriteLoopExecutor` in
  favor of the shared one in `v2/src/testing/write-loop-executor.ts`. The shared
  version exposes `settleFirst()` where the local copy exposed `settleOne()` —
  same behavior, rename at call sites. The local copy's `pendingKeys()` has no
  callers in this file and is dropped, not preserved.
- `startHandlers` stops constructing an `IpcServer`; it builds and returns/stores
  the handlers directly for the test to call.
- The `promoteQueuedRunImpl` unit tests (no socket, no server) are unaffected.

## Out of scope

- Converting `daemon-revise.test.ts` (separate subspec).
- Converting any other daemon test file.
- Deleting or thinning behavior coverage.

## Acceptance criteria

- [x] `daemon-queue-promotion.test.ts` contains no `startIpcServer`, `connectIpcClient`,
      `canUseUnixSockets`, `socketTest`, or `SOCKET_PATH` reference.
- [x] `daemon-queue-promotion.test.ts` imports `createFakeWriteLoopExecutor` from
      `../testing/write-loop-executor.ts` rather than defining it locally.
- [x] `bun test v2/src/daemon/daemon-queue-promotion.test.ts` passes with the same
      number of tests as before conversion and 0 skips in the agent sandbox.

## Documentation updates

None — internal test-harness change with no operator-facing or documented
behavior change.
