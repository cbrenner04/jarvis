---
name: trim-ipc-log-stream-exports
---

# Trim IPC and log-stream public surface

Drop `export` where symbols have no reference outside their file; delete outright if unused internally. IPC/persistence scope: `ipc/types` (`RequestFrame`, `StreamOpenFrame`) · `ipc/codec.ts` delete `FrameDecoder.reset()` (no callers) · `log-stream` (`IterationStartedEvent`, `BoundaryCommittedEvent`, `AppendWakeFactory`). No behavior change beyond visibility.

## Decisions

- De-export or delete listed symbols only — rules out refactors or codec API redesign.
- Delete `FrameDecoder.reset()` outright — rules out keeping as non-exported dead method.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are landed (seed 01)

## Documentation updates

- None — internal visibility trim with no operator-facing behavior change

## Verification

- `bun run typecheck`, `test:v2`, `test:integration:v2`
