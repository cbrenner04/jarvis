# 02 - Surface unrecoverable socket bind errors

## Problem

When `startIpcServer` bind still fails after occupancy reclaim, the child logs `listen` `EADDRINUSE` (or another errno) to `~/.jarvis/daemon-<digest>.log` and exits; `startDaemon` in `daemon-lifecycle.ts` surfaces only `Daemon process N died during startup` with no socket path, errno, or recovery hint — even though `jarvis cleanup` would fix the same path.

## Decisions

- A bind failure that survives bounded reclaim throws a typed error naming the socket path, errno, and `jarvis cleanup` recovery; rules out `Daemon process N died during startup` as the whole operator-facing message for this failure shape.
- Parent/child contract: child writes one structured bind-failure line (socket path, errno, `jarvis cleanup` recovery) to stderr before `process.exit(1)`; parent tails the daemon log on startup death and surfaces that payload on stderr; rules out mock-only `startIpcServer` throw satisfying the CLI contract while detached `jarvis daemon start` stays generic.
- `startDaemon` maps the parsed bind-failure payload through to the CLI caller without masking it behind the generic died-during-startup string; rules out requiring operators to read the daemon log for the only actionable diagnosis.
- Deferred to first consumer: whether `daemon-process-log-read` should subsume log-tail diagnosis for other startup deaths — pin when that command ships.

## Prerequisites

- Subspec 00 occupancy-aware reclaim in `startIpcServer`.

## Task checklist

- [ ] Introduce a typed bind-failure error and a structured stderr log marker in the IPC/daemon startup path when reclaim is exhausted.
- [ ] On startup death before readiness, have `startDaemon` tail the daemon log for the marker and rethrow the typed error to the CLI caller.
- [ ] Add a regression test on the detached-spawn path (`startDaemon` with `logPath`, real child) proving the operator-facing error shape.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts` test `unrecoverable socket bind names path errno and cleanup recovery` proves a bind failure that survives reclaim surfaces on the detached-spawn path an operator-facing error naming the socket path, `errno`, and `jarvis cleanup` recovery; it fails against the current bare `died during startup` (`daemon-lifecycle.sandbox-unrunnable.test.ts` test `throws if process dies during startup` is reachable on main).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — operator-runbook recovery prose lands in subspec 03 after this error shape exists.
