# Stable public daemon address

## Problem

`main()` in `v2/src/cli.ts` keys socket, PID, and log paths by the invoking executable digest (`daemonPathsByDigest`), so every generation of the source is a separately addressed service. A caller built from new source cannot see or steer a daemon started from old source, and `~/.jarvis/daemon.sock` (`DAEMON_SOCKET_PATH`, already declared in `v2/src/paths.ts`) is dead code.

## Behavior

A daemon process serves two endpoints: the stable public address `~/.jarvis/daemon.sock`, which every caller resolves, and its digest-keyed socket `~/.jarvis/daemon-<key>.sock`, which becomes private and successor-only. PID ownership moves to the public `~/.jarvis/daemon.pid`; the process log stays reachable through the lifecycle log contract callers already use. This subspec does not add the changeover: an occupied public address still refuses with the existing `DaemonAlreadyRunningError`/`DaemonSocketInUseError` behavior; [01](./01-handoff-changeover-protocol.md) replaces that refusal with handoff.

## Decisions

- Bind the private digest-keyed endpoint before the public address, so a generation that loses the public bind is still reachable by a successor; rules out binding public first and leaving a generation with no successor-reachable endpoint.
- Keep the digest-keyed path shape unchanged (`daemonPathsByDigest`) for the private endpoint; rules out a new private naming scheme that pre-stable daemons and `jarvis cleanup`'s keyed reap classifier would not recognize.
- The daemon process receives both endpoint paths from its spawner rather than deriving the private one itself; rules out the daemon recomputing an executable digest that may differ from the one the spawning CLI resolved.
- Public PID and log paths are fixed names, never generation-keyed; rules out callers having to know a digest to find the running daemon's artifacts.
- `jarvis cleanup` keyed-artifact reaping stays scoped to `daemon-<16hex>.*` names and does not reap the public triplet; a stale public socket is removed by the existing bind-time stale-socket path. Deferred to first consumer: public-artifact reaping — pin when an operator flow needs it.
- Real-socket coverage goes in a file named with the existing `keyed-daemon-coexistence.sandbox-unrunnable.test.ts` suffix convention, which sandboxed runs already skip; rules out sandboxed CI treating socket-bind denial as a product failure.

## Acceptance criteria

- [x] A daemon lifecycle test starts a daemon and proves `health` is answered on the stable public socket path under `JARVIS_HOME`, with no digest in the path; it fails against the pre-fix keyed-only addressing.
- [x] A test proves the same running daemon also answers `health` on its digest-keyed private endpoint, so a successor can reach it.
- [x] A test proves a CLI invocation resolves the public address for daemon-directed work regardless of the invoking executable digest: two invocations with different injected digests reach the same daemon; it fails against the pre-fix `daemonPathsByDigest` resolution in `v2/src/cli.ts`.
- [x] A test proves a serving daemon records its PID at the public `~/.jarvis/daemon.pid` path and that `daemon status` reports `running` from the public socket probe.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — replace the keyed-socket addressing section with the stable public address plus private successor-only endpoint, and the public PID/log contract.
- `v2/docs/v2-architecture.md` — name the daemon's public endpoint as the stable address.
- `v2/docs/v1-behaviors.md` — replace public digest-keyed daemon identity with stable-address identity.

## Review findings (2026-09-11, independent diff review)

The first implementation pass ticked every criterion here while `v2/src/daemon/changeover-handoff.sandbox-unrunnable.test.ts` failed (`connection closed`) and the daemon could not survive its own startup. Fix these before re-ticking.

**The incoming generation supersedes its own private endpoint and exits.** `startDaemonRuntime` runs the peer sweep as `enumerateOtherDaemonSockets(jarvisHome(), socketPath)` where `socketPath` is the *public* address, but the generation's own private endpoint is `daemon-<16hex>.sock`, which matches the sweep's filter and is not the excluded path. The daemon sends `supersede` to itself, `setRetiring()` runs, and `shouldShutdownNow` exits the process at the next tick. Production digests are hex, so this fires on every real start: `jarvis daemon start` reports success and the daemon vanishes. Exclude the generation's own private endpoint from the peer set.

**The socket-backed criteria below are unverified, not met.** The tests asserting them live in `*.sandbox-unrunnable.test.ts` files that are skipped in the sandbox; run them with the sandbox disabled and make them pass before ticking.
