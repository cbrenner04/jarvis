---
name: rolled-back-handoff-leaks-successor-socket
---

# A rolled-back self-handoff leaves the incumbent holding the successor's keyed socket

## Problem

A daemon self-handoff that rolls back can leave the incumbent still bound to the *successor's* keyed private socket. Every later handoff to that same observed digest then dies at bind time, permanently: the successor cannot take the address its own key names, and the incumbent never releases it. `jarvis cleanup` cannot help — the socket is genuinely live, just held by the wrong generation — so the only recovery is a manual daemon bounce.

The operator sees none of this. `DaemonSocketInUseError` (`v2/src/ipc/server.ts:256`) is thrown by `removeStaleSocketPath` (`:413`) inside the successor, but the successor's startup handler only emits the structured `JARVIS_DAEMON_BIND_FAILURE:` marker for `DaemonSocketBindFailureError` (`v2/src/daemon/daemon.ts:1597-1602`); an in-use error falls to the generic `console.error` branch. So `readBindFailureFromLog` (`v2/src/daemon/daemon-lifecycle.ts:162`) finds no marker and `startDaemon` throws the generic `Daemon process ${pid} died during startup` (`daemon-lifecycle.ts:380`), reached from the `deps.startHandoff` call in `stable-digest-trigger.ts:82`.

## Evidence (2026-09-20)

Daemon pid 7579 had loaded digest `8f652ef2676a…` against observed digest `b254d5d67cda49b1…`, and `lsof` showed that same pid 7579 holding `~/.jarvis/daemon-b254d5d67cda49b1.sock` on fd 10 — the successor's key. Every spawned successor died with `DaemonSocketInUseError: A daemon is already listening on …daemon-b254d5d67cda49b1.sock`, surfacing to the operator only as `Daemon process N died during startup`. `~/.jarvis/daemon.log` held 74 `Self-handoff triggered` lines: the trigger retried forever against a bind that could never succeed. The real cause was visible only by grepping the daemon log.

No code under `v2/src/daemon/`, `v2/src/ipc/` or `shared/` changed at or after the loaded revision, so this is pre-existing, not a regression from the handoff work.

## Decisions

- The incumbent never retains a successor's keyed socket across a rollback: it either releases that address as part of rollback, or never binds it in the first place. Rules out a rollback path whose only repair is a manual bounce.
- A repeated self-handoff to the same observed digest cannot be starved forever by an address the incumbent itself holds — the incumbent's own hold is a recoverable condition, not a foreign daemon.
- The operator-facing startup failure names the real bind failure and the socket path. `DaemonSocketInUseError` reaches the parent through the same structured marker path `DaemonSocketBindFailureError` already uses, instead of collapsing to `Daemon process N died during startup`. Rules out the daemon log being the only place the cause exists.
- Scope is handoff rollback and its error surfacing. No change to when a handoff is triggered, to digest sampling, or to the backoff schedule.

## Acceptance criteria

- [ ] A test proves an incumbent that rolls back a self-handoff no longer holds the successor's keyed socket path; it fails against the current rollback path.
- [ ] A test proves a second handoff attempt to the same observed digest can bind after a rolled-back first attempt.
- [ ] A test proves a successor that fails to bind with `DaemonSocketInUseError` surfaces that error and the contested socket path to the spawning caller, not `Daemon process N died during startup`; it fails against the current non-marker `console.error` branch in `daemon.ts`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — self-handoff rollback releases the successor's keyed address; an in-use bind failure is reported like any other bind failure.
- `v2/docs/operator-runbook.md` — a repeating `Self-handoff triggered` with a permanently failing successor is a leaked address, not a dead daemon; retire the "grep daemon.log" step once the error names itself.
