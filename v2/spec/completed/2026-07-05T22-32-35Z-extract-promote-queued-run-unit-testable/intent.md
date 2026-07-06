---
name: extract-promote-queued-run-unit-testable
---
# Extract Promote Queued Run Unit Testable

# Extract `promoteQueuedRun` into a standalone unit-testable function

`promoteQueuedRun`'s FIFO-with-skip promotion (oldest unclaimed queued run,
skip claimed keys, memory-headroom gate, settle-delay suppression) is a
closure inside `createRunControlHandlers` in `v2/src/daemon/daemon.ts`,
reachable for testing only through a real IPC socket round trip.

## Decision

Extract `promoteQueuedRun` into a standalone exported function taking store,
registry, memory-headroom check, and settle-delay state as explicit
parameters. No behavior change. Convert the pure promotion-ordering tests in
`daemon-queue-promotion.test.ts` to direct unit tests calling the extracted
function; keep any genuine RPC-wiring tests in that file on real sockets.

## Documentation updates

- `v2/docs/daemon-host.md`: note promotion logic (`#promotion-of-queued-runs`)
  lives in a standalone exported function, with the daemon wiring calling it.

## Prerequisites

- promoteQueuedRun FIFO-with-skip promotion and settle-delay suppression exist in v2/src/daemon/daemon.ts
- Memory-watermark admission with queued-status fallback is implemented
