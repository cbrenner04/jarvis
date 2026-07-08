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
- Both files use the direct-invocation helpers `startRunDirect`/`listRunsDirect` and
  `mockWriteLoopInput` from `v2/src/testing/run-control.ts` (the socket-based
  `startRun`/`listRuns` remain for other callers and are not used here).

## Out of scope

- Converting any other daemon test file.
- Deleting or thinning behavior coverage.

## Verification

Both files run with 0 skips in the agent sandbox; test counts unchanged.

## Prerequisites

- `v2/src/testing/` exports a shared `createFakeWriteLoopExecutor`
- `v2/src/testing/run-control.ts` exports direct-invocation `startRunDirect`/`listRunsDirect` (taking handlers) alongside `mockWriteLoopInput`
