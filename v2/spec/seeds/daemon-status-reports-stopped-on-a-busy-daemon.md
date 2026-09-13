---
name: daemon-status-reports-stopped-on-a-busy-daemon
---

# `daemon status` reports `stopped` for a healthy daemon that misses a one-second probe

## Problem

`getDaemonStatus` (`v2/src/daemon/daemon-lifecycle.ts:380`) decides liveness with `probeSocket(socketPath, healthTimeoutMs ?? 1_000)` and maps a falsy result straight to `{ state: "stopped" }`. `probeSocket` (`:74`) collapses *every* failure — RPC timeout, connect error, `ENOENT` — into `false`. So a daemon that is alive, listening, and serving other RPCs is reported dead whenever it cannot answer `health` within one second.

`stopped` is the most dangerous thing this command can say. It is the shape whose documented recoveries are `kill -9 <daemon-pid>` and starting a second daemon, and the daemon is shared across every registered project, so acting on a false `stopped` destroys live work for projects the operator is not even looking at. The function's own comment names this exact hazard for the *pid* input — "reporting `stopped` for a reachable daemon sends operators into destructive recovery for a machine that is working" — which #3473 fixed by deciding on the socket instead. The timeout path reintroduces the same lie through the socket.

The careful classifier already exists in this repo. `classifyDaemonSocketForCleanup` (`v2/src/commands/daemon.ts:60-85`) separates `stale`, `absent`, and timeout-class outcomes and states the rule outright: *"Timeout-class `live` is inconclusive: only an answered `health` proves a daemon; every other outcome (including a late ECONNREFUSED) preserves the path and reports why."* `getDaemonStatus` does not use it.

## Evidence (2026-09-13)

Observed live with five concurrent implement lanes, daemon at 95.7% CPU. Three consecutive `jarvis daemon status` calls, seconds apart, against one healthy daemon (pid 30728, pid file matching, both sockets bound, 13 open unix fds):

```text
running loaded=708bf577… current=d54e858f…   0.40s
stopped                                       1.24s
running loaded=708bf577… current=d54e858f…   1.35s
```

Throughout all three, `jarvis run list` and `jarvis pipeline list` answered normally and reported all five lanes live — so the daemon was serving the whole time. The flap is purely the one-second budget losing a race against a loaded event loop.

This is also the second observation of the same budget shape: the runbook already records cleanup's 500 ms socket probe timing out on a healthy daemon and calls that benign, because cleanup *preserves* on an inconclusive probe. Status does the opposite: it converts the same inconclusive answer into the word that triggers destructive recovery.

## Decisions

- A timeout is not proof of death. `daemon status` distinguishes "answered `health`" from "did not answer in time", and only a positively-dead socket (`stale`, or `absent` with no listener) reports `stopped`; an inconclusive probe reports its own state naming the reason and the elapsed budget. Rules out inconclusive-is-authoritative on the command that gates destructive recovery.
- Reuse the existing `classifyDaemonSocketForCleanup`-style classification rather than adding a second liveness vocabulary; rules out two disagreeing liveness classifiers in one codebase, which is the #3473 shape.
- A probe that times out is retried once at a longer budget before any non-live verdict, since the observed failure is a loaded event loop rather than a dead process. Rules out a single unlucky sample deciding.
- Scope is the status read path. No change to what `daemon start`/`stop` do with their own probes, and no change to the `loaded`/`current` revision reporting. Rules out widening into the digest-reporting question.

## Acceptance criteria

- [ ] A test proves a socket whose `health` RPC exceeds the probe budget, while the socket still accepts connections, does not report `stopped`; it fails against the current `probeSocket` false → `stopped` mapping.
- [ ] A test proves the inconclusive verdict names the reason and is distinguishable by an operator from a positively-dead daemon.
- [ ] A test proves a genuinely dead socket (present file, nothing listening) still reports `stopped`, and that an answered `health` still reports `running` with its `loaded`/`current` revisions unchanged.
- [ ] A test proves a timed-out probe is retried once at a longer budget before any non-live verdict is returned.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Daemon lifecycle: `stopped` means positively dead; an inconclusive probe is reported as such and is never grounds for `kill -9` or a second daemon. Retire the note that a busy daemon can read `stopped`.
- `v2/docs/daemon-host.md` — record the shared liveness classification used by status and cleanup.
