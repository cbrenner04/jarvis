# 00 — Migrate ipc.test.ts tail-log tests

`v2/src/ipc/ipc.test.ts` tail-log stream tests define inline `StreamHandler`
copies that omit `stateStore.loadRun` gating or use `logReader.tail()` instead
of production `follow` orchestration. Replace them with `createTailStreamHandler`
wired through `startIpcServer` over injected `stateStore` and `logReader` fakes.
Correct assertions that match copied-handler behavior instead of shipped handler
semantics.

## Decisions

- `ipc.test.ts` tail-log tests call `createTailStreamHandler` and pass it to `startIpcServer` — rules out inline `StreamHandler` copies in the test file.
- Injected `stateStore` and `logReader` fakes supply dependencies; production handler owns `loadRun` gating and `follow` pump — rules out reimplementing those paths in test-local handlers.
- Unknown-run coverage seeds persisted log events for the rejected `runId` with no durable `loadRun` row — rules out the `logReader.tail()`-only mock that closes without exercising `loadRun`.
- Scope is the three tail-log tests in `ipc.test.ts` only — rules out migrating unrelated IPC transport tests or moving tail coverage to `daemon-tail-stream.test.ts`.
- `v2/docs/test-writing.md` gains a tail-stream pointer or example alongside the run-control worked example — rules out deferring doc alignment to a follow-on slice.

## Tasks

- Import `createTailStreamHandler` and `openStateStore`; remove inline tail `StreamHandler` implementations from the three tail-log tests in `ipc.test.ts`.
- Wire each tail test's `startIpcServer` with `createTailStreamHandler({ stateStore, logReader })` over injected fakes (temp state DB, temp `logs.jsonl` reader; optional `follow` spy for abort coverage per `daemon-tail-stream.test.ts`).
- Replay test: durable run row plus persisted events; assert `stream-data` frames in ascending `seq` order.
- Unknown-run test: persisted events for `runId` with no `loadRun` row; assert immediate `stream-end` without `stream-data`.
- Client `stream-end` test: durable row plus at least one replayed event; assert `follow`'s `AbortSignal` is aborted after client `stream-end`.
- Update `v2/docs/test-writing.md`: extend the daemon worked example or add a one-line pointer that tail-stream IPC tests follow the same factory-over-fakes pattern (`createTailStreamHandler`, `ipc.test.ts`).

## Acceptance criteria

- [ ] `ipc.test.ts` tail-log tests wire `startIpcServer` with `createTailStreamHandler` over injected `stateStore` and `logReader`.
- [ ] `ipc.test.ts` has no inline `StreamHandler` implementations in the tail-log test section.
- [ ] Tail stream for a known run with a durable row and persisted log events replays `stream-data` frames in ascending `seq` order (`ipc.test.ts`).
- [ ] Tail stream for a `runId` with persisted log events but no `loadRun` row closes with `stream-end` and no `stream-data` (`ipc.test.ts`).
- [ ] After client `stream-end`, the `AbortSignal` passed to `logReader.follow` is aborted (`ipc.test.ts`).
- [ ] `ipc.test.ts` stays green.
- [ ] `bun run typecheck` and `bun run test` pass.
- [ ] `v2/docs/test-writing.md` documents that tail-stream IPC tests use `createTailStreamHandler` over injected fakes, consistent with the run-control factory-over-fakes pattern.

## Documentation updates

- `v2/docs/test-writing.md` — tail-stream factory-over-fakes pointer or worked example.
