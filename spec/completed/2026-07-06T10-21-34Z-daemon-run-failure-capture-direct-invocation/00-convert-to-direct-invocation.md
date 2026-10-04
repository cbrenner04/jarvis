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
- Every test in the file that currently closes/reopens the socket server mid-test to
  swap `failureReporter` or `writeLoopExecutor` instead reassigns `handlers` via a fresh
  `createRunControlHandlers(...)` call — this applies to all such tests in the file, not
  just an illustrative subset.

## Out of scope

- Converting any other daemon test file.
- Deleting or thinning behavior coverage — every existing test case in this file must
  still exist and still assert the same thing, just invoked directly.

## Acceptance criteria

- [x] `bun test v2/src/daemon/daemon-run-failure-capture.test.ts` runs with 0 skips in the agent sandbox.
- [x] `daemon-run-failure-capture.test.ts` has the same number of `test`/`socketTest`-turned-`test` cases as before conversion.
- [x] `daemon-run-failure-capture.test.ts` contains no references to `SOCKET_PATH`, `rmSync`, `canUseUnixSockets`, `startIpcServer`, `connectIpcClient`, or `toIpcHandlers`.

## Documentation updates

None — this is test-only harness plumbing with no behavior, architecture, or operator-facing change.
