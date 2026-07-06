# Convert daemon-run-failure-capture.test.ts to direct handler invocation

`v2/src/daemon/daemon-run-failure-capture.test.ts` boots a real unix-socket server +
SQLite, plus local reimplementations of `mockWriteLoopInput`/`startRun`/`listRuns`, to
reach `createRunControlHandlers`. Convert every test in the file to call the handlers
returned by `createRunControlHandlers` directly, and drop the local reimplementations
in favor of `v2/src/testing/run-control.ts`'s `startRunDirect`/`listRunsDirect`/
`mockWriteLoopInput`.

## Decisions

- Remove `SOCKET_PATH`, the `rmSync` socket-file cleanup, `canUseUnixSockets`, and the
  `socketTest` gating — no test in this file needs a real socket once invocation is direct.
- Delete the file's local `mockWriteLoopInput`, `startRun`, `listRuns`, and `RunSummary`/
  `ListRunsResult` types; import `mockWriteLoopInput`, `startRunDirect`, `listRunsDirect`
  from `../testing/run-control.ts` instead.
- `createHandlers()` keeps building via `createRunControlHandlers(...)` but its result is
  used directly (no `toIpcHandlers`, no `startIpcServer`).
- `beforeEach`/`afterEach` drop all socket/server setup and teardown; keep `stateStore`
  creation/close and the `reportedFailures`/`failureReporter`/`executorBehavior` fixture
  state.
- Tests that swap `failureReporter` or `writeLoopExecutor` mid-test (e.g. "spawn boundary
  forwards original rejection", "terminal durable status is not overwritten") rebuild
  handlers directly via `createRunControlHandlers(...)` instead of closing/reopening a
  socket server.

## Out of scope

- Converting any other daemon test file.
- Deleting or thinning behavior coverage — every existing test case in this file must
  still exist and still assert the same thing, just invoked directly.

## Acceptance criteria

- [ ] `bun test v2/src/daemon/daemon-run-failure-capture.test.ts` runs with 0 skips in the agent sandbox.
- [ ] `daemon-run-failure-capture.test.ts` has the same number of `test`/`socketTest`-turned-`test` cases as before conversion.
- [ ] `daemon-run-failure-capture.test.ts` contains no references to `SOCKET_PATH`, `rmSync`, `canUseUnixSockets`, `startIpcServer`, `connectIpcClient`, or `toIpcHandlers`.

## Documentation updates

None — this is test-only harness plumbing with no behavior, architecture, or operator-facing change.
