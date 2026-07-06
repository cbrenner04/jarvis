# Convert daemon-revise.test.ts to direct invocation

`v2/src/daemon/daemon-revise.test.ts` boots a real unix-socket `IpcServer` +
SQLite `StateStore` for every test to reach `createRunControlHandlers.resume`.
Convert it to call the handler directly.

## Decisions

- Replace `startIpcServer`/`connectIpcClient`/`toIpcHandlers`/`client.send` +
  `client.nextFrame()` with a direct call to `handlers.resume(...)`, via a
  `resumeDirect`-style request-frame helper. `daemon-start-list.test.ts`'s
  equivalent helper is private and file-local, not a shared export; this
  subspec adds its own local, file-scoped `resumeDirect` helper in
  `daemon-revise.test.ts` rather than a new export in
  `v2/src/testing/run-control.ts` — only `resume` is needed here (not
  pause/kill), and the intent scopes shared helpers to
  `startRunDirect`/`listRunsDirect`/`mockWriteLoopInput`.
- Drop `SOCKET_PATH`, `rmSync` on the socket path, `canUseUnixSockets`, and
  `socketTest` — every test in this file runs unconditionally.
- `beforeEach` builds and stores the handlers directly instead of starting an
  `IpcServer`.

## Out of scope

- Converting `daemon-queue-promotion.test.ts` (separate subspec).
- Converting any other daemon test file.
- Deleting or thinning behavior coverage.

## Acceptance criteria

- [x] `daemon-revise.test.ts` contains no `startIpcServer`, `connectIpcClient`,
      `canUseUnixSockets`, `socketTest`, or `SOCKET_PATH` reference.
- [x] `bun test v2/src/daemon/daemon-revise.test.ts` passes with the same number
      of tests as before conversion and 0 skips in the agent sandbox.

## Documentation updates

None — internal test-harness change with no operator-facing or documented
behavior change.
