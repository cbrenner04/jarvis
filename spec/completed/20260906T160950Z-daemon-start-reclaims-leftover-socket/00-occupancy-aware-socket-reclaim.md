# 00 - Occupancy-aware socket reclaim on daemon start

## Problem

`startIpcServer` calls `removeStaleSocketPath`, which unlinks only when `probeSocketLiveness` returns `stale`. Probe `absent` (including `ENOENT` from a path the caller cannot resolve) and probe timeout (`live` after 250ms) deliberately skip removal — correct for the unlink-a-live-daemon guard, but wrong when a socket **file** still occupies the path and nothing accepts: `listen` fails `EADDRINUSE` and every retry re-encounters the same state. `jarvis cleanup` already classifies that path dead via connect probe; startup does not reclaim it.

## Decisions

- Bind path order: initial probe → longer reprobe when initial is timeout-class `live` → `removeStaleSocketPath` (`stale` unlink only; `absent` skips removal) → `listen` → bounded occupancy reclaim on `EADDRINUSE`; rules out unsequenced reclaim and refusing before `listen` on timeout alone.
- When the longer reprobe still returns timeout-class `live`, bind path proceeds to `listen` without `DaemonSocketInUseError`; rules out a second timeout permanently blocking reclaim of an unbindable leftover path.
- Reclaim decides on the pair (probe liveness, path occupancy), not liveness alone; rules out handing an unbindable path to `listen` without a separate occupancy gate.
- Occupancy is never established by `stat`/`existsSync` alone; `EADDRINUSE` from `listen` plus a post-bind reprobe returning `stale` authorizes one unlink retry; rules out pre-emptive unlink and reclaim on `absent`+`EADDRINUSE` (the sandbox `ENOENT` false-negative shape).
- Post-`EADDRINUSE` reprobe returning `absent` never authorizes unlink; rules out treating initial-probe `absent` or `ENOENT` as proof of no accepting peer when `listen` is unbindable.
- Probe timeout does not silently become permanent refusal: an occupied path whose initial probe timed out is re-probed with a longer bound before `listen`; rules out machine load converting a dead socket into an unrecoverable one.
- `stale` paths are unlinked by `removeStaleSocketPath` before `listen` on main; occupancy reclaim covers only probe outcomes that skip that removal; rules out a third `stale`-class AC for a bug already fixed on main.
- `removeStaleSocketPath` direct-call semantics for injected `absent`/`live` probes stay unchanged; occupancy reclaim lives in `startIpcServer`'s bind path; rules out widening `removeStaleSocketPath` to unlink on `absent`, which would restore the sandbox `ENOENT` false-negative outage documented in `server.ts`.
- The injectable probe seam is the same `DetailedSocketProbe` production uses (`(path, timeoutMs) => SocketProbeDetail`), so an injected probe traverses the production bind path; rules out selecting a test-only branch by reference identity (`probe === probeSocketLiveness`), which left the extended-reprobe logic with no coverage at all.
- Export a shared socket-path classifier from `v2/src/ipc/server.ts` for later cleanup reuse; rules out duplicating classification logic in `v2/src/commands/daemon.ts` (wired in subspec 01).
- Deferred to first consumer: exact longer probe timeout constant — pin in `daemon-host.md` when operator-facing prose needs a number.

## Prerequisites

- `probeSocketLiveness`, `removeStaleSocketPath`, and `DaemonSocketInUseError` in `v2/src/ipc/server.ts`.
- `jarvis cleanup` dead-socket reaping in `v2/src/commands/daemon.ts` (`reapDeadDaemonSockets`).

## Task checklist

- [ ] Restructure `startIpcServer` bind path in order: initial probe → longer reprobe on timeout-class `live` (proceed to `listen` if still timeout-class `live`) → `removeStaleSocketPath` for `stale` only → `listen` → on `EADDRINUSE`, post-bind reprobe and unlink once only when reprobe returns `stale`.
- [ ] Export the shared socket-path classifier from `v2/src/ipc/server.ts` (foundation for subspec 01).
- [ ] Add reclaim regression tests in `v2/src/ipc/server.test.ts` covering occupied-path wedge cases, the post-bind reprobe gate, and the live-peer guard.

## Acceptance criteria

- [x] `v2/src/ipc/server.test.ts` test `startIpcServer reclaims a socket file with no listener bound` proves `startIpcServer` succeeds when a socket file occupies the path but nothing accepts, reclaiming only after `listen` returns `EADDRINUSE` and a post-bind reprobe returns `stale`; it fails against the pre-fix `EADDRINUSE`.
- [x] `v2/src/ipc/server.test.ts` test `startIpcServer removes a stale path revealed by the extended reprobe` proves a first probe that times out but whose longer reprobe resolves `stale` is removed on the ordinary pre-bind path; it fails against the pre-fix code.
- [x] `v2/src/ipc/server.test.ts` test `startIpcServer proceeds to listen when both probes time out with no accepting peer` proves a doubly-timed-out probe declines to refuse and lets `listen` adjudicate; deleting the extended-reprobe branch turns the first `live` into a `DaemonSocketInUseError` and fails this test (verified by mutation).
- [x] `v2/src/ipc/server.test.ts` test `startIpcServer refuses reclaim on EADDRINUSE when reprobe returns absent` proves `absent` never authorizes an unlink even under `EADDRINUSE` — the sandboxed-caller false negative; it fails against unconditional `absent` reclaim (verified by mutation).
- [x] `v2/src/ipc/server.test.ts` tests `startIpcServer refuses immediately when a peer answers the probe` and `startIpcServer refuses to unlink a live peer socket` prove a genuinely live peer's socket is never unlinked and still refuses with `DaemonSocketInUseError`; they fail against an unconditional-unlink fix.
- [x] `v2/src/ipc/server.test.ts` test `removeStaleSocketPath refuses to unlink a path a live daemon is serving` stays green.
- [x] `v2/docs/daemon-host.md` documents the occupancy-aware reclaim contract: liveness versus occupancy, bind-path order, bounded `EADDRINUSE` retry gated by post-bind `stale` reprobe, and probe-timeout retry.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — socket reclaim contract: liveness versus occupancy, bind-path order, bounded `EADDRINUSE` retry, and probe-timeout retry; reconcile stale-only removal prose in the socket-path section.
