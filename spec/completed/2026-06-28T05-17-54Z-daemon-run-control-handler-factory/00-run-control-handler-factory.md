# 00 — Run-control handler factory

`startDaemon` (`v2/src/daemon.ts`) defines run-control RPC handlers
(`start`/`list`/`pause`/`resume`/`kill`) inline in its closure.
`daemon-start-list.test.ts` simulates run-control behavior in-process (no
`normalizeBindings`, different error text and settlement); known drift stays
until the follow-on intent migrates tests to the factory. Extract the handlers
into an exported factory `startDaemon` wires in production; behavior and wire
contracts stay unchanged. Test wiring to the factory is the follow-on's contract.

## Decisions

- Export a run-control handler factory from `daemon.ts` for `startDaemon` and follow-on test use — enforceable consumption in this slice is production-only via `startDaemon`; rules out handlers reachable only through the blocking `startDaemon` entrypoint.
- Factory returns only `start`/`list`/`pause`/`resume`/`kill` handlers — rules out moving `health`/`status`/`shutdown`/`tail` into this slice.
- Factory owns per-instance `WorktreeOwnershipRegistry` and `activeRuns` state — rules out callers supplying registration maps that can drift from handler logic.
- Factory deps include injectable `stateStore` and `writeLoopExecutor` — rules out tests spawning a detached daemon to exercise real handler code.
- Factory omits `logReader` from deps — run-control handlers do not consume it (`tail` does); rules out blocking extraction on a tail-only dependency.
- `logsPath` is not a public factory dependency — remains a `startDaemon` production-wrapper concern until the follow-on pins test wiring.
- Production `writeLoopExecutor` boundary: factory owns the fire-and-forget IIFE and claim/release/cleanup around settlement; injected executor runs the write-loop body only; `logsPath` and log-sink open/close stay in `startDaemon`'s production wrapper — rules out placements that block follow-on fakes.
- `startDaemon` wires production `stateStore` and the production `writeLoopExecutor` wrapper (log-sink + `logsPath` + `executeWriteLoop`) through the factory — rules out duplicate handler bodies left in the `startDaemon` closure.
- Deferred to first consumer: exact `writeLoopExecutor` test-fake injectable signature — pin when `daemon-start-list-use-real-handlers` wires fakes.
- Deferred to first consumer: whether follow-on factory deps accept `logReader` — pin when that intent wires fakes.
- This slice does not rewrite `daemon-start-list.test.ts` — rules out coupling extraction to test migration in one PR.

## Tasks

- Extract run-control handler closures from `startDaemon` into an exported factory function and deps type in `daemon.ts`.
- Wire `startDaemon` to register factory-produced handlers with production dependencies.
- Doc-comment the exported factory symbol and deps type per `v2/docs/documentation-standard.md`.

## Acceptance criteria

- [x] `daemon.ts` exports a run-control handler factory returning `start`/`list`/`pause`/`resume`/`kill` handlers with injectable `stateStore` and `writeLoopExecutor`.
- [x] `startDaemon` registers run-control handlers produced by the factory with production dependencies (no duplicate handler bodies in the closure).
- [x] Exported factory symbol and deps type have doc-comments per `v2/docs/documentation-standard.md`.
- [x] `daemon.sandbox-unrunnable.test.ts` stays green.
- [x] `daemon-start-list.test.ts` stays green.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- Inline doc-comment on the exported factory and deps type (`v2/docs/documentation-standard.md`).
- No `v2/docs/` change — IPC wire contract and operator behavior are unchanged.
