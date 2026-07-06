---
name: daemon-start-list-direct-invocation
---
# Daemon Start List Direct Invocation

# Convert daemon-start-list.test.ts to direct handler invocation

`v2/src/daemon/daemon-start-list.test.ts` boots a real unix-socket server + SQLite to
reach `createRunControlHandlers`, a plain injectable function. Convert its tests to call
the handlers directly, dropping the socket harness for cases that don't need it.

## Decisions

- Call `createRunControlHandlers` output directly; remove `SOCKET_PATH`, `rmSync`, and
  `canUseUnixSockets`/`socketTest` gating for converted cases.
- Keep 1-2 socket round-trip smokes over the start/list handler set (JSON marshaling of
  params/results survives the wire) — do not delete socket coverage entirely.
- `reviewDebateProgressByInvocation` (module-global mutable map in `daemon.ts`, cleared in
  this file's `afterEach`) becomes an injected dependency of the handler factory; the
  global export is removed. This is the only production-source change.
- Establish the canonical `createFakeWriteLoopExecutor` in `v2/src/testing/`, adopting this
  file's variant (settle/abort/pause introspection) as the shared implementation.
- Adapt `startRun`/`listRuns`/`mockWriteLoopInput` in `v2/src/testing/run-control.ts` to
  invoke handlers directly instead of going through an `IpcClient`.

## Out of scope

- Converting any other daemon test file.
- Deleting or thinning behavior coverage.

## Verification

`daemon-start-list.test.ts` runs with 0 skips in the agent sandbox; test count unchanged
except the retained 1-2 socket smokes.

## Prerequisites
