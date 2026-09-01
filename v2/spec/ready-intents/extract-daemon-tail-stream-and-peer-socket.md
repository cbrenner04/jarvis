---
name: extract-daemon-tail-stream-and-peer-socket
---

# Extract daemon tail-stream and peer-socket modules

## Primary implementation surface

Daemon

## Problem

Tail-stream handling and startup peer enumeration/supersede (`enumerateOtherDaemonSockets`, `supersedePeerDaemon`) live inline in `daemon.ts`; `discoverLiveDaemonSockets` is already in `live-daemon-socket-discovery.ts`. Inline code has no coupling to run-control handler state, inflating the file targeted for handler modularization.

## Behavior

- Move tail-stream parsing/streaming and startup `enumerateOtherDaemonSockets` / `supersedePeerDaemon` into dedicated daemon modules wired from `daemon.ts`.
- Preserve stream-open, supersede RPC, and startup ordering semantics.

## Decision ledger

- Extract only tail-stream and peer-socket helpers first; rules out bundling them with run-control handler modularization in one review.
- Keep `createRunControlHandlers` untouched in this slice; rules out mixing transport extraction with handler-context refactors.

## Prerequisites

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-tail-stream.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts` enumerate/supersede cases stay green (behavior unchanged by the extraction).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates
