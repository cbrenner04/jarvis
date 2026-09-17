# 00 — RPC and signal retire triggers log their trigger

A committed successor exited silently via the drain-exit path (`shouldShutdownNow`, `startDrainExitLoop` in `v2/src/daemon/daemon.ts`); no log named what told it to retire.

## Decisions

- Path inventory in `v2/src/daemon/daemon.ts`, cover/exclude: `supersede` RPC (`supersedHandler`) — covered here. `changeover` RPC (the `changeover` closure in `createHandoffHandlers`) — covered here; it is the sole entry into a handoff, so self-handoff's incumbent-side retire (which arrives at this generation as a `changeover` RPC from the spawned successor) is covered here too, no separate site. `shutdown` RPC (`shutdownHandler`) — covered here. SIGTERM/SIGINT (`signalHandler`) — covered here. Drain exit itself (`startDrainExitLoop`/`shouldShutdownNow`) — covered here: one line at actual exit naming the first trigger recorded this generation. `handoff_commit`/`handoff_rollback` RPCs and the fallback-timer/health-probe resolution — covered in [01](01-handoff-trigger-logging.md), not here. Fatal `process.exit(1)` bind-failure sites (~line 1429, 1432) — excluded: both branches already log (`JARVIS_DAEMON_BIND_FAILURE:` or a generic startup-failure message) before exit, and the failure is pre-serving, not a retire of a running daemon.
- Log sink: the daemon log (`daemon.log`, the stdout/stderr redirect that `JARVIS_DAEMON_BIND_FAILURE:` already writes to), via `console.error` — not the per-run `logs.jsonl` sink.
- Trigger line format: fixed prefix `JARVIS_DAEMON_RETIRE_TRIGGER:` followed by `JSON.stringify({ trigger })`, `trigger` one of `supersede`/`changeover`/`shutdown`/`sigterm`/`sigint`. Same shape as `formatDaemonBindFailureLogLine`.
- Drain-exit line format: fixed prefix `JARVIS_DAEMON_DRAIN_EXIT:` followed by `JSON.stringify({ trigger })`, naming the first trigger recorded this generation (`trigger: null` if the daemon exits with none recorded).
- Each line is written at the branch that actually starts the retire transition (calls `setRetiring`/sets `shutdownRequested`), not on an early-return/no-op branch (e.g. `changeover` against an already-pending or already-committed transaction). A repeated genuine trigger (e.g. two `supersede` calls) logs every time; no dedup.
- Caller identity: `supersede`/`changeover`/`shutdown` all carry no params on the wire today (called with `undefined` params — see `daemon-peer-socket.ts`, `daemon-changeover.ts`, `daemon-lifecycle.ts`). Deferred to first consumer: caller identity — pin when a caller needs it. The line names the RPC/signal only.
- The signal handler is extracted into a directly unit-testable function (same shape as the existing `createChangeoverHandler` extraction in this file) so SIGTERM/SIGINT logging is testable without sending a real signal or spawning a subprocess.
- No `v2/docs/v1-behaviors.md` update: this is net-new logging, not a change to existing behavior.
- Logging only; retire/drain/exit behavior unchanged.

## Acceptance criteria

- [x] A test in `v2/src/daemon/` asserts `supersede`, `changeover`, `shutdown`, and SIGTERM/SIGINT-driven retire each write the `JARVIS_DAEMON_RETIRE_TRIGGER:` line naming that trigger at the point the handler/signal actually starts retiring, not merely before the daemon exits; it fails against the pre-fix code.
- [x] A test asserts the daemon writes one `JARVIS_DAEMON_DRAIN_EXIT:` line at drain exit naming the first trigger recorded this generation; it fails against the pre-fix code.
- [x] `daemon-retire-superseded.test.ts` stays green (retire behavior unchanged).
- [x] `daemon-changeover.test.ts`, `daemon-changeover-handler.test.ts`, and `daemon-changeover.sandbox-unrunnable.test.ts` stay green (changeover behavior unchanged).
- [x] `generation-drain-and-exit.sandbox-unrunnable.test.ts` stays green (drain-exit behavior unchanged).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § "Daemon retirement on supersession" — document the `JARVIS_DAEMON_RETIRE_TRIGGER:`/`JARVIS_DAEMON_DRAIN_EXIT:` line format and which sites write them.
