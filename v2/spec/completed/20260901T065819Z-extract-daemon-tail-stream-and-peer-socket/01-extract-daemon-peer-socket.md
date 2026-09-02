# 01 - Extract daemon peer-socket supersede

`enumerateOtherDaemonSockets`, `supersedePeerDaemon`, and their injectable types live inline in `v2/src/daemon/daemon.ts` (~lines 2578–2667) with no coupling to run-control handler state. `discoverLiveDaemonSockets` already lives in `live-daemon-socket-discovery.ts`; startup peer enumeration is a separate sync listing + best-effort `supersede` RPC contract.

## Decisions

- New module `v2/src/daemon/daemon-peer-socket.ts` owns `enumerateOtherDaemonSockets`, `supersedePeerDaemon`, `EnumerateOtherDaemonSockets`, and `SupersedePeerDaemon`; rules out folding them into `live-daemon-socket-discovery.ts`, which probes liveness rather than fire-and-forget supersede.
- Post-listen peer supersede ordering is preserved by leaving the `startDaemonRuntime` loop in `daemon.ts`; rules out relocating that loop into the peer module, running supersede before listen, or adding new ordering tests in this slice.
- `DaemonStartupDeps` optional injectables remain on `daemon.ts` and default to the extracted implementations; rules out removing test injection seams.
- `DaemonStartupDeps` imports `EnumerateOtherDaemonSockets` and `SupersedePeerDaemon` from `daemon-peer-socket.ts`; rules out duplicating those type aliases in `daemon.ts`.
- Peer supersede remains best-effort with ignored errors; rules out surfacing unreachable-socket failures to startup.
- `daemon-lifecycle.sandbox-unrunnable.test.ts` imports peer helpers from the new module; rules out a permanent re-export shim on `daemon.ts`.
- `createRunControlHandlers` stays untouched; rules out mixing peer-socket extraction with handler modularization.

## Out of scope

- Tail-stream parsing/streaming (subspec 00).
- `discoverLiveDaemonSockets` / TUI live-daemon aggregation behavior.
- Any change to supersede RPC semantics, `daemon_superseded` admission guards, or retirement shutdown.

## Task checklist

- [ ] Create `v2/src/daemon/daemon-peer-socket.ts` with `enumerateOtherDaemonSockets`, `supersedePeerDaemon`, and the two injectable type aliases.
- [ ] Remove the moved symbols from `daemon.ts`; keep `DaemonStartupDeps` injectables and the post-listen async supersede loop in `startDaemonRuntime`, defaulting to the extracted functions.
- [ ] Point `daemon-lifecycle.sandbox-unrunnable.test.ts` supersede describe imports at `daemon-peer-socket.ts`.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts` enumerate/supersede cases stay green (behavior unchanged by the extraction).
- [x] `bun run typecheck` passes with no errors introduced by the move.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.
- [x] `daemon.ts` no longer defines `enumerateOtherDaemonSockets`, `supersedePeerDaemon`, `EnumerateOtherDaemonSockets`, or `SupersedePeerDaemon`; they live only in `v2/src/daemon/daemon-peer-socket.ts`.

## Documentation updates

- `v2/docs/v1-behaviors.md` — update the digest-keyed daemon supersede bullet `Sources` to cite `daemon-peer-socket.ts` instead of `daemon.ts` for enumeration/supersede implementation.
- `v2/docs/v2-architecture.md` — add `peer-socket supersede` to the daemon-host functional parenthetical in the domain map.
