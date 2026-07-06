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
- Remove now-unused helpers/fixtures only if no remaining test in the file references
  them (test scope only; no production code changes).

## Out of scope

- Consolidating the fake IpcClient / fixed-uuid helpers (separate intent).
- Any change to daemon or ipc test files.

## Acceptance criteria

- [ ] `tui-daemon-client.test.ts` retains exactly one `socketTest` case (the unreachable-socket
  rejection); the other coverage in the file is unchanged.
- [ ] `bun run test:v2` passes.

## Documentation updates

- None — test-only change, no behavior, workflow, or operator-facing semantics change.
