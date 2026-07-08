# 00 - Convert daemon-wait-run-completion.test.ts to direct handler invocation

`v2/src/daemon/daemon-wait-run-completion.test.ts` boots a real unix-socket
`IpcServer` + `connectIpcClient` to exercise `createRunControlHandlers`'
`wait`/`list` methods, which are plain injectable functions
(`(frame, signal) => Promise<IpcFrame> | IpcFrame`). Call the returned handler
map directly instead.

## Decisions

- Replace `startIpcServer`/`connectIpcClient` with direct calls into the object
  `createRunControlHandlers(...)` returns: `handlers.wait({ kind: "request", id, method: "wait", params }, signal)`,
  `handlers.list({ kind: "request", id, method: "list" }, signal)` — both
  `RpcHandler`s take the same required `(frame, signal)` shape.
- Drop `SOCKET_PATH`, the `rmSync` socket-file cleanup, `canUseUnixSockets`,
  and `socketTest` — no socket file exists to leak or gate on.
- Keep `openStateStore`/`openLogSink`/`openLogReader` against real temp-file
  paths (SQLite + JSONL) — only the IPC transport is removed, not the
  persistence layer under test.
- Signal convention (applies to every handler call in this file): each call
  site constructs its own `new AbortController()` and passes `.signal`; only
  a test that exercises abort behavior calls `.abort()` on that controller.
- "pending wait does not block other RPCs on the same connection" tests that
  a second RPC is serviceable while a `wait()` promise is still outstanding.
  This is distinct from "two concurrent waits resolve with the same terminal
  payload" (fanout of two `wait()` calls on the same `runId`, unchanged, and
  not to be duplicated). Rewrite it as: call `handlers.wait(...)` without
  awaiting it, then call and `await` `handlers.list(...)`, asserting the list
  response resolves and returns the run while the wait promise is still
  pending; then call `finishLoop` and await the original wait promise to
  confirm it resolves afterward.
- "disconnecting one wait client leaves other waiters and durable status
  alone" tests socket-disconnect detachment, which has no direct-invocation
  analog. Rewrite as: issue two `wait()` calls on the same `runId` with
  independent `AbortController`s, abort the first caller's signal, and assert
  the first promise rejects/is abandoned while the second remains pending,
  `stateStore.loadRun(runId)?.status` is unchanged by the abort, and the
  second promise resolves normally once `finishLoop` runs.

## Out of scope

- Converting `daemon-start-list.test.ts` or any other daemon test file.
- Changing `createRunControlHandlers` or `WaitFanout` behavior.

## Documentation updates

None — internal test-infrastructure change, no operator-visible or v1-parity
behavior changes.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-wait-run-completion.test.ts` no longer imports
      `startIpcServer`, `connectIpcClient`, or `canUseUnixSockets`, and has no
      `SOCKET_PATH`/socket-file `rmSync`.
- [x] `bun test v2/src/daemon/daemon-wait-run-completion.test.ts` passes with
      the same number of `test`/`socketTest` cases as before conversion, 0
      skipped.
- [x] The converted file still asserts, each in some test: two `wait()` calls
      on the same `runId` resolve with the identical terminal payload
      (fanout); a `list()` call resolves while a `wait()` on the same `runId`
      is still outstanding; aborting one waiter's signal leaves a second
      waiter on the same `runId` pending and leaves durable run status
      unchanged; and every other pre-conversion behavior (missing/unknown
      `runId` rejection, quiescent-run immediate resolve, resume-on-next-edge,
      failed/killed error payload parity with `list`) is still asserted.
