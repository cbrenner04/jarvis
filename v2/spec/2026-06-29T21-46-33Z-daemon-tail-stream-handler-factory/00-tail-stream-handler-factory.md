# 00 — Tail-stream handler factory

`startDaemon` (`v2/src/daemon.ts`) defines the log-tail `StreamHandler` inline
in its closure (`loadRun` gates unknown runs; `logReader.follow` replays and
streams). Extract it into an exported factory `startDaemon` and agent-runnable
tests consume. Tail semantics and IPC wire contract stay unchanged.

## Decisions

- Export a tail-stream handler factory from `daemon.ts` — rules out handler logic reachable only through the blocking `startDaemon` closure.
- Factory accepts injected `stateStore` and `logReader` — rules out tests spawning a detached daemon to reach real tail semantics.
- Factory returns one `StreamHandler` — rules out bundling `health`/`status`/`shutdown` or run-control handlers into this slice.
- `startDaemon` registers the factory-produced handler with production `stateStore` and `logReader` — rules out duplicate handler body left in the closure.
- `logsPath` stays a `startDaemon` production concern (default `logReader` open/close) — rules out making log path a public factory dependency.
- Unknown run: `loadRun` miss closes the stream without `stream-data` — rules out replaying via `tail()` alone without a durable run row.
- Known run: `follow(runId, signal)` drives replay and live append — rules out snapshot-only `tail()` in the production handler path.
- This slice does not rewrite `ipc.test.ts` tail-log tests — rules out coupling extraction to IPC test migration in one PR.
- Co-locate new factory tests in `daemon-tail-stream.test.ts` — rules out leaving the factory production-only until a later intent.

## Tasks

- Extract the tail `StreamHandler` closure from `startDaemon` into an exported factory function and deps type in `daemon.ts`.
- Wire `startDaemon` to pass the factory-produced handler to `startIpcServer` with production dependencies.
- Add `daemon-tail-stream.test.ts`: wire `startIpcServer` with the factory over injected `stateStore` and `logReader`; use shared socket skip fixture.
- Doc-comment the exported factory symbol and deps type per `v2/docs/documentation-standard.md`.

## Acceptance criteria

- [ ] `daemon.ts` exports a tail-stream handler factory returning a `StreamHandler` with injectable `stateStore` and `logReader`.
- [ ] `startDaemon` registers the factory-produced tail handler with production dependencies (no duplicate handler body in the closure).
- [ ] `daemon-tail-stream.test.ts` wires `startIpcServer` with the exported factory over injected fakes.
- [ ] `daemon-tail-stream.test.ts`: opening a tail stream for a run with a durable row and persisted log events replays them in `seq` order.
- [ ] `daemon-tail-stream.test.ts`: opening a tail stream for a `runId` with no `loadRun` row closes without `stream-data`.
- [ ] `daemon-tail-stream.test.ts`: client `stream-end` aborts the server-side `follow` signal.
- [ ] Exported factory symbol and deps type have doc-comments per `v2/docs/documentation-standard.md`.
- [ ] `daemon.sandbox-unrunnable.test.ts` stays green.
- [ ] `daemon-start-list.test.ts` stays green.
- [ ] `daemon-run-failure-capture.test.ts` stays green.
- [ ] `ipc.test.ts` stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- Inline doc-comment on the exported factory and deps type (`v2/docs/documentation-standard.md`).
- No `v2/docs/` change — IPC wire contract and operator tail behavior are unchanged.
