---
name: init-check-probes-legacy-unkeyed-daemon-paths
---

# `jarvis init --check` reports `daemon missing` while the keyed daemon is running

## Problem

The readiness report's `daemon` row is produced by `defaultCheckDaemon` in `v2/src/commands/init-readiness.ts`, which first reads `DAEMON_PID_PATH` (`~/.jarvis/daemon.pid`) and, when that file is absent, returns `stopped` without probing anything. Daemons have been digest-keyed for months: the live process writes `~/.jarvis/daemon-<16hex>.pid` and listens on `daemon-<16hex>.sock`, and the unkeyed `daemon.pid` / `daemon.sock` no longer exist on an operator machine. The row therefore always prints `daemon missing: daemon is not running`, and `init --check` exits `1`, even when `jarvis daemon status` in the same shell reports `running` at the current digest.

The readiness report is documented as the session-start go/no-go, so a permanently red row trains the operator to ignore it.

## Evidence

Observed 2026-09-08 immediately after a `main` merge and daemon bounce: `jarvis init --profile home --check` printed seven `ok` rows and `daemon missing: daemon is not running`; `jarvis daemon status` printed `running loaded=c602bd82… current=c602bd82…`. `ls ~/.jarvis` showed one `daemon-756be403a9944391.sock` and no unkeyed `daemon.sock` or `daemon.pid`.

## Decisions

- The readiness probe resolves the daemon the same way `jarvis daemon status` does: the socket keyed to the current executable digest (the `deps.socketPath` the daemon command uses), with `stale` when a different-digest daemon answers and `stopped` only when no keyed socket answers.
- The unkeyed `DAEMON_PID_PATH` pre-check is removed from the readiness path; a pid file is not evidence of liveness and its absence is not evidence of death.
- A regression test pins the probe against a keyed socket fixture with the legacy unkeyed paths absent.

## Documentation updates

- `v2/docs/install-and-config.md` § `jarvis init`: state that the `daemon` row reflects the digest-keyed daemon and matches `jarvis daemon status`.
