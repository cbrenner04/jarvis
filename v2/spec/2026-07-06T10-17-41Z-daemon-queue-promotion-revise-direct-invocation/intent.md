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

- Second prerequisite unconfirmed: `v2/src/testing/run-control.ts`'s `startRun`/`listRuns` still
  send frames through an `IpcClient` (`client.send` + `client.nextFrame`), not direct handler
  invocation. Direct invocation exists in that file only as separately named `startRunDirect`/
  `listRunsDirect` (used today by `daemon-start-list.test.ts`), which the intent does not
  reference. Either `startRun`/`listRuns` need to become the direct-invocation entry points (and
  their `IpcClient`-based callers updated), or the intent should name `startRunDirect`/
  `listRunsDirect`/`mockWriteLoopInput` instead. Please clarify before drafting.
