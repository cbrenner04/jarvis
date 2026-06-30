# 00 — Tail-stream handler factory

`startDaemon` (`v2/src/daemon.ts`) defines the log-tail `StreamHandler` inline
in its closure (`loadRun` gates unknown runs; `logReader.follow` replays and
streams). Extract it into exported `createTailStreamHandler` that `startDaemon`
and agent-runnable tests consume. Tail semantics and IPC wire contract stay
unchanged.

## Prerequisites

- Daemon tail-log stream semantics are implemented (`stateStore.loadRun` gates unknown runs; `follow` replays persisted events).
- Run-control handler factory extraction pattern exists in `daemon.ts` (`createRunControlHandlers`).

## Decisions

- Export `createTailStreamHandler` and `TailStreamHandlerDeps` from `daemon.ts` — rules out handler logic reachable only through the blocking `startDaemon` closure or alternate naming.
- Factory accepts injected `stateStore` and `logReader` — rules out tests spawning a detached daemon to reach real tail semantics.
- Factory returns one `StreamHandler` — rules out bundling `health`/`status`/`shutdown` or run-control handlers into this slice.
- `startDaemon` registers the factory-produced handler with production `stateStore` and `logReader` — rules out duplicate handler body left in the closure.
- `logsPath` stays a `startDaemon` production concern (default `logReader` open/close) — rules out making log path a public factory dependency.
- Invalid payload: missing or non-string `runId` closes the stream without `stream-data` — rules out emitting replay for malformed `stream-open` payloads.
- Unknown run: `loadRun` miss closes the stream without `stream-data` — rules out replaying via `tail()` alone without a durable run row.
- Known run: `follow(runId, signal)` drives replay and live append — rules out snapshot-only `tail()` in the production handler path.
- `ipc.test.ts` tail tests stay on inline mocks until follow-on intent [`ipc-tail-stream-use-real-handler`](../ready-intents/ipc-tail-stream-use-real-handler.md) migrates them to the real factory — rules out treating new factory tests as redundant IPC coverage or migrating IPC tests in this slice.
- This slice does not rewrite `ipc.test.ts` tail-log tests — rules out coupling extraction to IPC test migration in one PR.
- Co-locate new factory tests in `daemon-tail-stream.test.ts` — rules out leaving the factory production-only until a later intent.
- Deferred to first consumer: live-append tail assertion — pin when a caller needs it (likely IPC migration intent).

## Tasks

- Extract the tail `StreamHandler` closure from `startDaemon` into exported `createTailStreamHandler` and `TailStreamHandlerDeps` in `daemon.ts`.
- Wire `startDaemon` to pass the factory-produced handler to `startIpcServer` with production dependencies.
- Add `daemon-tail-stream.test.ts`: wire `startIpcServer` with `createTailStreamHandler` over injected `stateStore` and `logReader`; socket skip per `v2/docs/test-writing.md` and `daemon-start-list.test.ts` (`canUseUnixSockets`, `test.skipIf`, hook guards). Durable row via injected `stateStore`; persisted events via temp `logs.jsonl` sink/reader — patterns in `daemon-start-list.test.ts` and `ipc.test.ts`.
- Doc-comment `createTailStreamHandler` and `TailStreamHandlerDeps` per `v2/docs/documentation-standard.md`.

## Acceptance criteria

- [x] `daemon.ts` exports `createTailStreamHandler` returning a `StreamHandler` with injectable `stateStore` and `logReader` via `TailStreamHandlerDeps`.
- [x] `startDaemon` registers the factory-produced tail handler with production dependencies (no duplicate handler body in the closure).
- [x] `daemon-tail-stream.test.ts` wires `startIpcServer` with `createTailStreamHandler` over injected fakes.
- [x] `daemon-tail-stream.test.ts`: opening a tail stream for a run with a durable row and persisted log events replays them in `seq` order.
- [x] `daemon-tail-stream.test.ts`: opening a tail stream with missing or non-string `runId` closes without `stream-data`.
- [x] `daemon-tail-stream.test.ts`: opening a tail stream for a `runId` with no `loadRun` row closes without `stream-data`.
- [x] `daemon-tail-stream.test.ts`: after client `stream-end`, the `AbortSignal` passed to `logReader.follow` is aborted.
- [x] `createTailStreamHandler` and `TailStreamHandlerDeps` doc-comments state purpose, params, returns, thrown errors, and invariants per `v2/docs/documentation-standard.md` (deps fields; handler: `loadRun` before `follow`, `onClose` in `finally`, non-throwing).
- [x] `daemon.sandbox-unrunnable.test.ts` stays green.
- [x] `daemon-start-list.test.ts` stays green.
- [x] `daemon-run-failure-capture.test.ts` stays green.
- [x] `ipc.test.ts` stays green.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- Inline doc-comment on `createTailStreamHandler` and `TailStreamHandlerDeps` (`v2/docs/documentation-standard.md`).
- No other `v2/docs/` change — IPC wire contract and operator tail behavior are unchanged.
- `v2/docs/test-writing.md` tail-stream factory example — owned by follow-on intent [`ipc-tail-stream-use-real-handler`](../ready-intents/ipc-tail-stream-use-real-handler.md), not this slice.
