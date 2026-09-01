# 00 - Extract daemon tail-stream

`createTailStreamHandler`, `parseTailStreamParams`, `streamRunLogRecords`, and `TailStreamHandlerDeps` live inline in `v2/src/daemon/daemon.ts` (~lines 2431–2576) with no coupling to `createRunControlHandlers` state, inflating the file targeted for handler modularization.

## Decisions

- New module `v2/src/daemon/daemon-tail-stream.ts` owns tail-stream parsing and streaming; rules out leaving the region inline or bundling it with peer-socket extraction in one review.
- `sleepOrAbort` moves with `streamRunLogRecords` as a private helper in that module; rules out exporting a one-off sleep helper from `daemon.ts`.
- `FOLLOW_POLL_MS` stays imported from `../persistence/log-stream.ts` in the new module; rules out duplicating the poll constant in daemon code.
- `daemon.ts` keeps only wiring: `startDaemonRuntime` builds `createTailStreamHandler({ stateStore, logReader })` and passes it to `startIpcServer`; rules out relocating `startDaemonRuntime` or run-control handlers in this slice.
- `createRunControlHandlers` and its closure graph stay untouched; rules out mixing transport extraction with handler-context refactors.
- All `createTailStreamHandler` consumers import from the new module; rules out a permanent re-export shim on `daemon.ts` for test convenience.

## Out of scope

- `enumerateOtherDaemonSockets`, `supersedePeerDaemon`, and startup supersede wiring (subspec 01).
- Any behavior change to stream-open payload parsing, follow settlement, or IPC error mapping.

## Task checklist

- [ ] Create `v2/src/daemon/daemon-tail-stream.ts` with `TailStreamHandlerDeps`, `parseTailStreamParams`, `streamRunLogRecords`, and `createTailStreamHandler` (including `sleepOrAbort`).
- [ ] Remove the moved symbols from `daemon.ts`; import `createTailStreamHandler` for `startDaemonRuntime` wiring only.
- [ ] Retarget `createTailStreamHandler` imports to `daemon-tail-stream.ts` in `daemon-tail-stream.test.ts`, `run-list-since-queries-history.test.ts`, `run-list-dimension-filters.test.ts`, and `tui-log-tail-client.sandbox-unrunnable.test.ts`.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-tail-stream.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `bun run typecheck` passes with no errors introduced by the move.
- [ ] `bun run test:v2` passes.
- [ ] `daemon.ts` no longer defines `TailStreamHandlerDeps`, `parseTailStreamParams`, `streamRunLogRecords`, or `createTailStreamHandler`; they live only in `v2/src/daemon/daemon-tail-stream.ts`.

## Documentation updates

- `v2/docs/v1-behaviors.md` — update `Sources` paths on the `stream-open` / `--follow` settlement bullets to cite `daemon-tail-stream.ts` instead of `daemon.ts` where tail-stream implementation is the source.
- `v2/docs/v2-architecture.md` — add `tail-stream` to the daemon-host functional parenthetical in the domain map.
