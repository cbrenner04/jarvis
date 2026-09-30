---
name: failed-self-handoff-leaves-daemon-refusing-work
---

# A failed self-handoff restores a daemon that accepts work

## Problem

Twice on 2026-09-30 (after merges #4168 and #4194+#4186), under machine load 30–46, the autonomous self-handoff failed and left the sole daemon alive but refusing all new work. `~/.jarvis/daemon.log`: `Self-handoff triggered…` → RETIRE_TRIGGER `changeover` → `supersede` → `handoff_fallback resolution rollback` → `Daemon handoff fallback failed: Cannot bind daemon socket …/daemon.sock: EADDRINUSE` (first time) → `handoff_rollback` → `Self-handoff failed: … DaemonReadinessTimeoutError: … within 5000ms`. Afterwards every new-work RPC returned `daemon_superseded: Daemon is retiring and not accepting new work`, `daemon status` reported the old revision, and nothing recovered for minutes; operator `jarvis daemon start` fixed it immediately both times.

Mechanism (`v2/src/daemon/`):

- **Readiness bound.** `DEFAULT_DAEMON_READINESS_TIMEOUT_MS = 5_000` (`daemon-changeover.ts:18`), applied in `startDaemon` (`daemon-lifecycle.ts:281`, loop `:377`, throw `:412`). Self-handoff (`daemon.ts:1690`) and manual `daemon start` (`v2/src/commands/daemon.ts:154`) both omit `readinessTimeoutMs`, so both share the fixed 5s bound; on a loaded machine the successor misses it and `startDaemon` kills it.
- **Admission stays closed.** The successor, once privately listening, runs the best-effort peer supersede pass (`daemon.ts:1630`, `daemon-peer-socket.ts:19`) and reaches the incumbent, whose `supersedHandler` sets `superseded = true` (`daemon.ts:1539–1543`). `rollback` reopens admission only when `!deps.wasSuperseded()` (`daemon.ts:1051–1052`), so the rebind succeeds but `runControlContext.retiring` stays true: every `start`/`resume`/approve gets `daemon_superseded` (`daemon.ts:968`). The supersede came from the very successor being rolled back, which is the one case it must not stick.
- **Backoff never reopens.** `startStableDigestTrigger` records the failure and retries after 1m doubling (`stable-digest-trigger.ts:20–24,58–62`), but the sampling interval skips every tick while `isRetiring()` (`daemon.ts:1713`), so the retry never fires and no path clears `retiring`.
- **EADDRINUSE fallback.** The incumbent's fallback timer (`resolveFallback`, `daemon.ts:1087–1107`) probed the public address not-live (slow successor) and rolled back; `bindPublicServer` hit EADDRINUSE because the successor still held/was binding the path, `rollback` restored `retiring` (`daemon.ts:1054–1058`) and `scheduleFallback` retried until a later `handoff_rollback` rebind won — still with admission closed per above.

## Decisions

- A rolled-back handoff restores admission on the incumbent. A `supersede` received while a handoff is pending (from the handoff's own successor) does not survive rollback; only a supersede outside a pending handoff keeps the incumbent retiring.
- A daemon that is retiring with no pending handoff, no committed successor answering the public address, and the public listener bound as the sole owner reopens admission (self-heal), so the stable-digest backoff retry can fire.
- Readiness bound tolerates loaded-machine startup: self-handoff passes a longer `readinessTimeoutMs` (and the fallback timer stays longer than it), or the bound extends while the successor process is alive and making progress. No wall-clock-only 5s cutoff for a live successor.
- Fallback rollback that loses the rebind to a live successor defers to that successor's verdict rather than racing it.

## Acceptance criteria

- [ ] `createHandoffHandlers` test with fakes: changeover → `supersede` → rollback leaves `retiring === false` and a subsequent `start` is admitted.
- [ ] Same with `supersede` and no pending handoff: rollback-less incumbent stays retiring (existing guard preserved).
- [ ] Fallback path test: first `bindPublicServer` rejects EADDRINUSE, rescheduled attempt succeeds → admission reopened, transaction `rolled_back`.
- [ ] Stable-digest trigger test with fake clock/scheduler: after a failed handoff and rollback, the next sampling tick past the backoff window calls `startHandoff` again.
- [ ] Pure predicate for the self-heal condition exported and tested in both truth directions.
- [ ] Self-handoff `startDaemon` call passes a readiness bound larger than `DEFAULT_DAEMON_READINESS_TIMEOUT_MS` (or progress-extended); unit test with fake prober proves a live successor that becomes ready after 5s still commits.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Autonomous self-handoff: rollback restores admission even after the successor's supersede; readiness bound; backoff retry now reachable.
- `v2/docs/operator-runbook.md` § Daemon lifecycle: symptom `daemon_superseded` on a sole daemon after `Self-handoff failed`; expected self-recovery; `jarvis daemon start` as the manual fallback.

See [AGENTS.md](../../../AGENTS.md).
