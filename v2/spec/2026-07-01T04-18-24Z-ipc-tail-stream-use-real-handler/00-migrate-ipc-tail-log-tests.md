# 00 — Migrate ipc.test.ts tail-log tests

`v2/src/ipc/ipc.test.ts` tail-log stream tests define inline `StreamHandler`
copies that omit `stateStore.loadRun` gating or use `logReader.tail()` instead
of production `follow` orchestration. Replace them with `createTailStreamHandler`
wired through `startIpcServer` over injected `stateStore` and `logReader` fakes.
Correct fixtures and assertions that match copied-handler behavior instead of
shipped handler semantics.

Completes deferred `ipc.test.ts` migration and tail `test-writing.md` example
from [`2026-06-29T21-46-33Z-daemon-tail-stream-handler-factory`](../completed/2026-06-29T21-46-33Z-daemon-tail-stream-handler-factory/).

## Prerequisites

- `createTailStreamHandler` is exported from `daemon.ts` and consumed by `startDaemon` ([`2026-06-29T21-46-33Z-daemon-tail-stream-handler-factory`](../completed/2026-06-29T21-46-33Z-daemon-tail-stream-handler-factory/)).
- `v2/docs/test-writing.md` documents the run-control factory-over-fakes pattern (`createRunControlHandlers` worked example).

## Decisions

- `ipc.test.ts` tail-log tests call `createTailStreamHandler` and pass it to `startIpcServer` — rules out inline `StreamHandler` copies in the test file.
- Injected `stateStore` and `logReader` fakes supply dependencies; production handler owns `loadRun` gating and `follow` pump — rules out reimplementing those paths in test-local handlers.
- Fixture semantic upgrade, not preservation — replay/unknown-run fixtures gain durable-row / orphan-log shapes matching production `loadRun` gating; current `ipc.test.ts` replay test is false-green against real handler (logs only, no row) — rules out characterizing the slice as behavior-preserving refactor.
- Unknown-run coverage seeds orphan persisted events (logs exist, no `loadRun` row) and asserts `logReader.follow` is not invoked — rules out the `logReader.tail()`-only mock that closes without exercising `loadRun`.
- Abort coverage uses injected `follow` wrapper spy (`onFollow` pattern in `daemon-tail-stream.test.ts`) — rules out inline `followAborted` capture incompatible with real factory.
- Per-test isolated tail servers — preserve per-test `tailServer` override of suite default server; add `stateStore` per test — rules out shared `beforeEach` hook coupling tail lifecycle to RPC suite setup.
- Post-migration suite overlap — `daemon-tail-stream.test.ts` keeps handler guard matrix; `ipc.test.ts` keeps colocated IPC+tail integration — rules out deleting IPC tail tests or merging suites as "duplicate."
- Invalid-payload guards out of scope — missing/non-string `runId` covered in daemon suite only — rules out expanding IPC tail section to full guard matrix.
- Scope is the three tail-log tests in `ipc.test.ts` only — rules out migrating unrelated IPC transport tests or moving tail coverage to `daemon-tail-stream.test.ts`.
- No `v1-behaviors.md` update — test-only slice; production tail semantics unchanged — rules out spec-guidance behavior-change doc churn.
- `v2/docs/test-writing.md` gains a tail-stream pointer or example alongside the run-control worked example — rules out deferring doc alignment to a follow-on slice.

## Tasks

- Import `createTailStreamHandler` and `openStateStore`; remove inline tail `StreamHandler` implementations from the three tail-log tests in `ipc.test.ts`.
- Copy lifecycle and fixture patterns from `daemon-tail-stream.test.ts`, not current `ipc.test.ts` tail section: per-test temp state DB via `openStateStore` with `stateStore.close()` teardown; `seedRun` / `createRunWithLogs` for replay; orphan-log setup for unknown-run; required `follow` wrapper spy (`followCalled`, `onFollow`) for abort coverage.
- Wire each tail test's `startIpcServer` with `createTailStreamHandler({ stateStore, logReader })` over injected fakes (temp `logs.jsonl` reader).
- Replay test: durable run row plus persisted events; assert `stream-data` frames in ascending `seq` order.
- Unknown-run test: orphan persisted events for `runId` with no `loadRun` row; assert immediate `stream-end` without `stream-data` and `logReader.follow` not invoked.
- Client `stream-end` test: durable row plus at least one replayed event; assert `follow`'s `AbortSignal` is aborted via `onFollow` spy after client `stream-end`.
- Update `v2/docs/test-writing.md`: extend the daemon worked example or add a one-line pointer that tail-stream IPC tests follow the same factory-over-fakes pattern (`createTailStreamHandler`, `ipc.test.ts`).

## Acceptance criteria

- [ ] `ipc.test.ts` tail-log tests wire `startIpcServer` with `createTailStreamHandler` over injected `stateStore` and `logReader`.
- [ ] `ipc.test.ts` has no inline `StreamHandler` implementations in the tail-log test section.
- [ ] Tail stream for a known run with a durable row and persisted log events replays `stream-data` frames in ascending `seq` order (`ipc.test.ts`).
- [ ] Tail stream for a `runId` with orphan persisted events but no `loadRun` row closes with `stream-end`, emits no `stream-data`, and does not invoke `logReader.follow` (`ipc.test.ts`).
- [ ] After client `stream-end`, the `AbortSignal` passed to `logReader.follow` is aborted, observed via injected `follow` wrapper spy (`ipc.test.ts`).
- [ ] `ipc.test.ts` stays green (implementation gate; wire semantics contract lives in behavioral ACs above).
- [ ] `bun run typecheck` and `bun run test` pass.
- [ ] `v2/docs/test-writing.md` documents that tail-stream IPC tests use `createTailStreamHandler` over injected fakes, consistent with the run-control factory-over-fakes pattern.

## Documentation updates

- `v2/docs/test-writing.md` — tail-stream factory-over-fakes pointer or worked example.
