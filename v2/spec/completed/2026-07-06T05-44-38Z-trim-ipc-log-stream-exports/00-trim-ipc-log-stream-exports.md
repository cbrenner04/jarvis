# 00 — Trim IPC and log-stream exports

Drop `export` on file-local-only symbols in `v2/src/ipc/` and
`v2/src/persistence/log-stream.ts`; delete `FrameDecoder.reset()`. No runtime
behavior change.

## Out of scope

- Other modules' export trims (separate intents).
- Codec API redesign, log-stream contract changes, or doc-comment rewrites beyond removing `reset()`'s comment.
- `v2/docs/v1-behaviors.md` — no operator-facing behavior change.
- Full seed 02 (`v2/spec/seeds/02-v2-dead-weight-purge.md`) — only ipc/log-stream de-export/delete entries land here.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are landed (seed 01)

## Decisions

- Fulfills only seed 02 ipc/log-stream de-export/delete entries (`RequestFrame`, `StreamOpenFrame`, `FrameDecoder.reset()`, `IterationStartedEvent`, `BoundaryCommittedEvent`, `AppendWakeFactory`) — rules out treating this as completing dead-weight-purge.
- Post-merge: remove those six symbols from `v2/spec/seeds/02-v2-dead-weight-purge.md` — rules out duplicate work on a future seed-02 run.
- De-export or delete only the listed symbols — rules out refactors or broader dead-code sweeps.
- `RequestFrame` and `StreamOpenFrame` become file-local types in `ipc/types.ts`; `IpcFrame` stays exported — rules out removing the union members or changing wire shapes.
- Delete `FrameDecoder.reset()` and its doc-comment outright — rules out keeping a non-exported dead method.
- `IterationStartedEvent`, `BoundaryCommittedEvent`, and `AppendWakeFactory` become file-local in `log-stream.ts`; exported `LogEvent`, `AppendWake`, `openLogSink`, and `openLogReader` unchanged — rules out narrowing the public log-stream API beyond visibility.
- No durable doc updates — rules out speculative `v2/docs/` churn for an internal visibility trim.

## Task checklist

- [ ] In `v2/src/ipc/types.ts`, remove `export` from `RequestFrame` and `StreamOpenFrame`.
- [ ] In `v2/src/ipc/codec.ts`, delete `FrameDecoder.reset()` and its doc-comment.
- [ ] In `v2/src/persistence/log-stream.ts`, remove `export` from `IterationStartedEvent`, `BoundaryCommittedEvent`, and `AppendWakeFactory`.
- [ ] Post-merge: remove the six ipc/log-stream symbols from `v2/spec/seeds/02-v2-dead-weight-purge.md` de-export/delete list.
- [ ] Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] `RequestFrame` and `StreamOpenFrame` are not exported from `v2/src/ipc/types.ts`; `IpcFrame` remains exported.
- [x] `FrameDecoder` in `v2/src/ipc/codec.ts` has no `reset` method.
- [x] `IterationStartedEvent`, `BoundaryCommittedEvent`, and `AppendWakeFactory` are not exported from `v2/src/persistence/log-stream.ts`.
- [x] `v2/src/ipc/ipc.test.ts` stays green (IPC codec/client/server behavior unchanged).
- [x] `v2/src/persistence/log-stream.test.ts` stays green (log-stream behavior unchanged).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — internal visibility trim with no operator-facing behavior change.
