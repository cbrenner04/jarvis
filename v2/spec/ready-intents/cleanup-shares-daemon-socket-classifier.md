---
name: cleanup-shares-daemon-socket-classifier
---

# Cleanup dead-socket reaper shares the daemon socket classifier

## Prerequisites

- Startup reclaim classifies socket paths by connect-probe liveness plus listen occupancy, not liveness alone.
- `EADDRINUSE` from `listen` is the authoritative occupancy signal; reclaim retries once after `EADDRINUSE` when the probe proved no peer accepts.
- A live peer socket refuses with `DaemonSocketInUseError` and is never unlinked.
- The IPC layer exports one shared socket classifier consumed by `startIpcServer` reclaim.

## Problem

`reapDeadDaemonSockets` in `v2/src/commands/daemon.ts` classifies dead sockets with its own `classifySocket` health-RPC probe, while `startIpcServer` uses `probeSocketLiveness` and occupancy-aware reclaim. The same leftover path can be dead to cleanup and wedged to startup, so operators recover only by knowing cleanup exists.

## Decisions

- `reapDeadDaemonSockets` adopts the shared IPC socket classifier for dead versus live versus preserved verdicts; rules out a parallel health-RPC classification path that disagrees with startup reclaim.
- Cleanup apply semantics stay unchanged: dead sockets are removed, preserved sockets are reported and skipped; rules out widening cleanup to reclaim paths startup would refuse.

## Acceptance criteria

- [ ] `v2/src/commands/daemon.test.ts` or `v2/src/commands/cleanup.test.ts` test `startup reclaim and cleanup reaper classify an identical path identically` proves the shared classifier yields the same dead/live verdict for the same socket path in both `startIpcServer` reclaim and `reapDeadDaemonSockets`; it fails against the current divergent classifiers.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — cross-link cleanup dead-socket reaping to the shared classifier contract in the socket-path section.
- `v2/docs/write-behavior.md` — align or cross-link the Cleanup command dead-socket classification prose (`ECONNREFUSED`/`ENOENT` only) to the shared classifier contract.
- `v2/docs/v1-behaviors.md` — update the cleanup daemon socket reaping entry to state it uses the same classifier as daemon-start reclaim.
