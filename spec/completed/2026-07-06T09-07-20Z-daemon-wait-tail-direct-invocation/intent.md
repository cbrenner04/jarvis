---
name: daemon-wait-tail-direct-invocation
---
# Daemon Wait Tail Direct Invocation

# Convert wait-run-completion and tail-stream daemon tests to direct handler invocation

`v2/src/daemon/daemon-wait-run-completion.test.ts` and
`v2/src/daemon/daemon-tail-stream.test.ts` each boot a real unix-socket server + SQLite to
reach `createRunControlHandlers`/`createTailStreamHandler`, both plain injectable
functions. Convert both to direct handler invocation.

## Decisions

- Call the handler factories' output directly in both files; remove per-file
  `SOCKET_PATH`, `rmSync`, and `canUseUnixSockets`/`socketTest` gating.
- Neither file depends on the shared `createFakeWriteLoopExecutor` or `run-control.ts`
  helpers, so this conversion has no dependency on those.

## Out of scope

- Converting any other daemon test file.
- Deleting or thinning behavior coverage.

## Verification

Both files run with 0 skips in the agent sandbox; test counts unchanged.

## Prerequisites
