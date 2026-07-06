---
name: daemon-queue-promotion-revise-direct-invocation
---
# Daemon Queue Promotion Revise Direct Invocation

# Convert queue-promotion and revise daemon tests to direct handler invocation

`v2/src/daemon/daemon-queue-promotion.test.ts` and `v2/src/daemon/daemon-revise.test.ts`
each boot a real unix-socket server + SQLite, with their own copy-pasted harness, to reach
`createRunControlHandlers`. Convert both to direct handler invocation.

## Decisions

- Call `createRunControlHandlers` output directly in both files; remove per-file
  `SOCKET_PATH`, `rmSync`, and `canUseUnixSockets`/`socketTest` gating.
- `daemon-queue-promotion.test.ts` drops its local `createFakeWriteLoopExecutor` in favor
  of the shared one in `v2/src/testing/`.
- Both files use the direct-invocation `startRun`/`listRuns`/`mockWriteLoopInput` from
  `v2/src/testing/run-control.ts`.

## Out of scope

- Converting any other daemon test file.
- Deleting or thinning behavior coverage.

## Verification

Both files run with 0 skips in the agent sandbox; test counts unchanged.

## Prerequisites

- `v2/src/testing/` exports a shared `createFakeWriteLoopExecutor`
- `v2/src/testing/run-control.ts`'s `startRun`/`listRuns`/`mockWriteLoopInput` invoke daemon handlers directly rather than through an `IpcClient`

## Blocker

Neither prerequisite is met in the current repo:

- `createFakeWriteLoopExecutor` is not exported from `v2/src/testing/`. It exists only as
  copy-pasted local functions in `v2/src/tui/tui-daemon-client.test.ts`,
  `v2/src/daemon/daemon-start-list.test.ts`, and `v2/src/daemon/daemon-queue-promotion.test.ts`.
- `v2/src/testing/run-control.ts`'s `startRun`/`listRuns` take an `IpcClient` and send
  wire-protocol request/response frames (`client.send(...)`, `client.nextFrame()`) — they
  invoke the daemon through IPC, not by calling handler functions directly.

Need either: (a) a prior subspec that adds a shared `createFakeWriteLoopExecutor` export and
converts `run-control.ts` helpers to direct handler invocation, or (b) revise this intent to
include that foundational work in scope.
