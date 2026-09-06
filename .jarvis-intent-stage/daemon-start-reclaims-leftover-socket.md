---
name: daemon-start-reclaims-leftover-socket
---

# Daemon start reclaims its own leftover socket

## Prerequisites

## Problem

After an abrupt daemon death, the keyed socket file can survive with no listener bound. `removeStaleSocketPath` removes only on probe `stale`, so probe `absent` on an occupied path or probe timeout on a loaded machine skips removal and `listen` fails `EADDRINUSE` permanently. The child logs the bind error and exits; the parent surfaces only `Daemon process N died during startup`. `jarvis cleanup` already classifies the same path dead and removes it.

## Decisions

- Reclaim decides on the pair (probe liveness, path occupancy), not liveness alone; rules out `absent`/timeout skipping removal and handing an unbindable path to `listen`.
- Occupancy is never established by `stat`/`existsSync` alone; `EADDRINUSE` from `listen` is the authoritative occupancy signal, so reclaim retries once after `EADDRINUSE` when the probe proved no peer accepts; rules out pre-emptive unlink that reintroduces the unlink-a-live-daemon outage.
- A bind that still fails after that bounded retry surfaces the socket path, `errno`, and `jarvis cleanup` recovery in the operator-facing error; rules out `Daemon process NNNN died during startup` as the whole message.
- Export one shared socket classifier from the IPC layer for reuse by cleanup; rules out duplicating classification logic in a second subsystem.
- Probe timeout does not silently become permanent refusal: an unbindable path whose probe timed out is retried with a longer bound before refusing; rules out machine load converting a dead socket into an unrecoverable one.

## Acceptance criteria

- [ ] `v2/src/ipc/server.test.ts` test `startIpcServer reclaims a socket file with no listener bound` proves `startIpcServer` succeeds when a socket file occupies the path but nothing accepts; it fails against the current `EADDRINUSE`.
- [ ] `v2/src/ipc/server.test.ts` test `startIpcServer reclaims when probe reports absent on an occupied path` and test `startIpcServer reclaims when probe times out with no accepting peer` prove both wedge cases succeed after reclaim; they fail against the current code.
- [ ] `v2/src/ipc/server.test.ts` test `startIpcServer refuses to unlink a live peer socket` proves a genuinely live peer's socket is never unlinked and still refuses with `DaemonSocketInUseError`; it fails against an unconditional-unlink fix.
- [ ] `v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts` or `v2/src/ipc/server.test.ts` test `unrecoverable socket bind names path errno and cleanup recovery` proves a bind failure that survives reclaim produces an operator-facing error naming the socket path, `errno`, and `jarvis cleanup` recovery; it fails against the current bare `died during startup`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — socket reclaim contract: liveness versus occupancy, bounded `EADDRINUSE` retry, and probe-timeout retry.
- `v2/docs/operator-runbook.md` — recovery for a wedged `daemon start`; note diagnosis lives in `~/.jarvis/daemon-<digest>.log` until `daemon-process-log-read` ships.
- `v2/docs/v1-behaviors.md` — record reclaim of an unbindable leftover socket on daemon start.
