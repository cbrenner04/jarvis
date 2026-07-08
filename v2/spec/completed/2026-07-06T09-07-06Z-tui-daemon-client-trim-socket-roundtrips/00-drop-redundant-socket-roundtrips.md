# Drop redundant socketTest round-trip cases

`v2/src/tui/tui-daemon-client.test.ts` has `socketTest` round-trip cases duplicating
transport/daemon behavior already covered by the ipc and daemon test suites.

## Decisions

- Remove these `socketTest` cases: "health round-trips over a test IPC server", "status
  round-trips over a test IPC server", "list round-trips over a test IPC server", "wait
  round-trips over a test IPC server", "list succeeds while wait is pending on the same
  socket connection".
- Keep "rejects unreachable socket with TuiDaemonConnectionError and sends no RPCs" —
  this is `tui-daemon-client`'s own connection-failure contract, not duplicated coverage.
- Remove the per-test `beforeEach`/`afterEach` fixture (state store, log sink, fake
  executor, real `IpcServer` on `SOCKET_PATH`) and helpers `finishLoop`, `expectRunId`,
  `input()`, along with any now-unreferenced imports (`createRunControlHandlers`,
  `startIpcServer`/`IpcServer`, `openLogReader`/`openLogSink`/`LogSink`,
  `openStateStore`/`StateStore`) — the surviving case does not use them.
- Keep `UNREACHABLE_SOCKET_PATH` and anything the surviving case uses untouched.

## Out of scope

- Consolidating the fake IpcClient / fixed-uuid helpers (separate intent).
- Any change to daemon or ipc test files.

## Acceptance criteria

- [x] `tui-daemon-client.test.ts` retains exactly one `socketTest` case (the unreachable-socket
  rejection); the other coverage in the file is unchanged.
- [x] No dead imports or unused fixture code tied to the removed cases remains (verified
  by `bun run typecheck`).
- [x] `bun run test:v2` passes.

## Documentation updates

- None — test-only change, no behavior, workflow, or operator-facing semantics change.
