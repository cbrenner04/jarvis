# 00 — Run-control handler factory

`startDaemon` (`v2/src/daemon.ts`) defines run-control RPC handlers
(`start`/`list`/`pause`/`resume`/`kill`) inline in its closure.
`daemon-start-list.test.ts` duplicates the same logic. Extract the handlers into
an exported factory both `startDaemon` and tests can wire over injected
dependencies. Behavior and wire contracts stay unchanged; test migration to the
factory is a follow-on intent.

## Decisions

- Export a run-control handler factory from `daemon.ts` consumed by `startDaemon` and tests — rules out handlers reachable only through the blocking `startDaemon` entrypoint.
- Factory returns only `start`/`list`/`pause`/`resume`/`kill` handlers — rules out moving `health`/`status`/`shutdown`/`tail` into this slice.
- Factory owns per-instance `WorktreeOwnershipRegistry` and `activeRuns` state — rules out callers supplying registration maps that can drift from handler logic.
- Factory deps include injectable `stateStore` and `writeLoopExecutor` — rules out tests spawning a detached daemon to exercise real handler code.
- `startDaemon` wires production `stateStore`, `openLogSink` + `logsPath`, and `executeWriteLoop` through the factory — rules out duplicate handler bodies left in the `startDaemon` closure.
- Deferred to first consumer: whether factory deps also accept `logReader` — intent names it; run-control handlers do not consume it today; pin when `daemon-start-list-use-real-handlers` wires fakes.
- Deferred to first consumer: exact `writeLoopExecutor` injectable signature — pin when tests inject a fake; production keeps background spawn, claim/release, and cleanup around the real `executeWriteLoop`.
- This slice does not rewrite `daemon-start-list.test.ts` — rules out coupling extraction to test migration in one PR.

## Tasks

- Extract run-control handler closures from `startDaemon` into an exported factory function and deps type in `daemon.ts`.
- Wire `startDaemon` to register factory-produced handlers with production dependencies.
- Doc-comment the exported factory symbol and deps type per `v2/docs/documentation-standard.md`.

## Acceptance criteria

- [ ] `daemon.ts` exports a run-control handler factory returning `start`/`list`/`pause`/`resume`/`kill` handlers with injectable `stateStore` and `writeLoopExecutor`.
- [ ] `startDaemon` registers run-control handlers produced by the factory with production dependencies (no duplicate handler bodies in the closure).
- [ ] `daemon.sandbox-unrunnable.test.ts` stays green.
- [ ] `daemon-start-list.test.ts` stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- Inline doc-comment on the exported factory and deps type (`v2/docs/documentation-standard.md`).
- No `v2/docs/` change — IPC wire contract and operator behavior are unchanged.
