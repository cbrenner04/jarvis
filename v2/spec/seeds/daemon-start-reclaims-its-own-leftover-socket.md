---
name: daemon-start-reclaims-its-own-leftover-socket
---

# An abrupt daemon death wedges every later `daemon start` on `EADDRINUSE`, undiagnosably

## Problem

After a daemon dies abruptly, its socket **file** survives with nothing bound to it. Every subsequent `jarvis daemon start` then fails, deterministically and forever, with no operator-facing diagnosis. The machine has no working daemon and no path back to one.

What the operator sees:

```text
$ jarvis daemon status
stopped
$ jarvis daemon start
Error: Daemon process 69727 died during startup
$ jarvis daemon start
Error: Daemon process 69815 died during startup
```

What actually happened, recoverable only from `~/.jarvis/daemon-<digest>.log`:

```text
error: Failed to listen at /Users/…/.jarvis/daemon-a3822611e507debe.sock
 syscall: "listen", errno: 48, code: "EADDRINUSE"
  at startIpcServer (v2/src/ipc/server.ts:365)
```

### The logic hole

`removeStaleSocketPath` (`v2/src/ipc/server.ts:323-339`) removes the path only on `stale`:

```ts
if (liveness === "live") throw new DaemonSocketInUseError(socketPath);
if (liveness === "stale") rmSync(socketPath, { force: true });
```

`absent` deliberately removes nothing — correctly, since `absent` is `ENOENT` from `connect`, and the code documents that a sandboxed caller gets `ENOENT` for a socket a live daemon is serving. Deleting there is the outage this guard exists to prevent.

But **`absent` and "the path is free to bind" are not the same claim**, and the code treats them as one. When the probe returns `absent` while a file still occupies the path, `startIpcServer` proceeds straight to `listen`, which fails `EADDRINUSE` — and nothing in the process can recover, because the only removal branch was already skipped. The same dead end is reachable from a probe timeout (`LIVENESS_PROBE_TIMEOUT_MS` is 250 ms, and `setTimeout(() => settle("live"))` classifies a slow probe as live) — on a loaded machine a leftover socket can read `live` and refuse forever.

Either way, the failure is **permanent**: the state that causes it is exactly the state a retry re-encounters.

### Two subsystems disagree about the same socket

`jarvis cleanup` classifies this socket correctly and fixes it on the first try:

```text
Found 1 dead daemon socket(s) for cleanup:
  remove: /Users/…/.jarvis/daemon-a3822611e507debe.sock
Removed daemon socket: …
```

After that one command, `daemon start` succeeded immediately. So the harness already knows how to make this judgement — the knowledge just is not on the startup path. That asymmetry is the cheapest thing to fix here.

## Evidence (2026-09-06)

The operator's daemon died abruptly during a session (three implement lanes live, plus two other registered projects' lanes). Measured at the wedged moment:

- socket file present at the keyed path
- `lsof` on the path: nothing bound; `ps` for `daemon-entrypoint.ts`: zero processes
- a raw `connect()` from Python: **`ECONNREFUSED` (errno 61)** — i.e. the path satisfied the harness's own definition of `stale`, and the reclaim still did not happen
- two consecutive `daemon start` attempts, both `EADDRINUSE`

Recovery required knowing that `jarvis cleanup` reaps sockets — not discoverable from any message the operator saw.

## Decisions

- Reclaim decides on the pair (probe liveness, path occupancy), not liveness alone: a path that is occupied but has no accepting peer is reclaimed; rules out `absent`/timeout skipping removal and handing an unbindable path to `listen`.
- Occupancy is never established by `stat`/`existsSync` alone as grounds for deletion — the existing false-negative reasoning stands. `EADDRINUSE` from `listen` is the authoritative occupancy signal, so reclaim retries once after an `EADDRINUSE` when the probe proved no peer accepts, rather than pre-emptively unlinking; rules out reintroducing the unlink-a-live-daemon outage this guard was built for.
- A bind that still fails after that bounded retry surfaces the socket path, `errno`, and the `jarvis cleanup` recovery in the operator-facing error; rules out `Daemon process NNNN died during startup` as the whole message.
- Startup socket reclaim and `jarvis cleanup`'s dead-socket reaper share one classifier; rules out two subsystems reaching opposite verdicts on the same path (they do today).
- The probe timeout does not silently become a permanent refusal: an unbindable path whose probe timed out is retried with a longer bound before refusing; rules out machine load converting a dead socket into an unrecoverable one.

## Acceptance criteria

- [ ] An `ipc/server.test.ts` test proves `startIpcServer` succeeds against a socket **file** left at the path with no listener bound; it fails against the current `EADDRINUSE`.
- [ ] A test proves the same when the liveness probe returns `absent` while the path is occupied, and when it times out (`live`) while no peer accepts; both currently wedge.
- [ ] A test proves a genuinely live peer's socket is still never unlinked and still refuses with `DaemonSocketInUseError` — the existing outage guard; it fails against an unconditional-unlink fix.
- [ ] A test proves a bind failure that survives reclaim produces an operator-facing error naming the socket path, `errno`, and the `jarvis cleanup` recovery; it fails against the current bare "died during startup".
- [ ] A test proves startup reclaim and `jarvis cleanup`'s dead-socket reaper classify an identical path identically.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — socket reclaim contract: liveness versus occupancy, and the bounded retry.
- `v2/docs/operator-runbook.md` — recovery for a wedged `daemon start`; note that the diagnosis lives in `~/.jarvis/daemon-<digest>.log` until `daemon-process-log-read` ships.
- `v2/docs/v1-behaviors.md` — record reclaim of an unbindable leftover socket.
