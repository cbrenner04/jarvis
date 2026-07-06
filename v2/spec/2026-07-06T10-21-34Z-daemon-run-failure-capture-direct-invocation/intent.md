---
name: daemon-run-failure-capture-direct-invocation
---
# Daemon Run Failure Capture Direct Invocation

# Convert daemon-run-failure-capture.test.ts to direct handler invocation

`v2/src/daemon/daemon-run-failure-capture.test.ts` boots a real unix-socket server +
SQLite, plus its own local reimplementations of `mockWriteLoopInput`/`startRun`/
`listRuns`, to reach `createRunControlHandlers`. Convert to direct handler invocation and
drop the local reimplementations.

## Decisions

- Call `createRunControlHandlers` output directly; remove `SOCKET_PATH`, `rmSync`, and
  `canUseUnixSockets`/`socketTest` gating.
- Delete this file's local `mockWriteLoopInput`/`startRun`/`listRuns` in favor of the
  direct-invocation helpers `startRunDirect`/`listRunsDirect`/`mockWriteLoopInput` in
  `v2/src/testing/run-control.ts` (the socket-based `startRun`/`listRuns` remain for
  other callers and are not used here).

## Out of scope

- Converting any other daemon test file.
- Deleting or thinning behavior coverage.

## Verification

`daemon-run-failure-capture.test.ts` runs with 0 skips in the agent sandbox; test count
unchanged.

## Prerequisites

- `v2/src/testing/run-control.ts` exports direct-invocation `startRunDirect`/`listRunsDirect` (taking handlers) alongside `mockWriteLoopInput`
