# Daemon host and IPC

v2's long-running orchestration host. The CLI, TUI, and future surfaces are thin
clients over its local IPC API. `executeWriteLoop` and below stay unchanged; the
daemon is a second driver, not a rewrite of the write loop.

## Role

- Own orchestration lifecycle and in-memory invocation tracking for daemon runs.
- Expose request/response control over a Unix-domain socket.
- Keep durable run state in SQLite (`~/.jarvis/state/v2.sqlite`); the daemon does
  not store work products.

`jarvis daemon status` reports daemon health only (socket reachability, pid,
active invocation run IDs). `jarvis status` (later) reports run snapshots from
durable state — different scope, different command.

## Socket and framing

- Socket path: `~/.jarvis/daemon.sock` on POSIX.
- Newline-delimited JSON frames.
- Request: `{ "id": string, "method": string, "params"?: unknown }`.
- Response: `{ "id": string, "ok": boolean, "result"?: unknown, "error"?: { "code", "message", "data"? } }`.
- Stream frames share the socket: `{ "kind": "stream", "id", "event", "data"? }`
  with one terminal response frame per request when the stream ends.

Request `id` must match the response `id`.

## Lifecycle commands

```
jarvis daemon start [--jarvis-root <path>]
jarvis daemon stop  [--jarvis-root <path>]
jarvis daemon status [--jarvis-root <path>]
```

- `start` — bootstraps `~/.jarvis/`, binds the socket, and runs detached via
  `daemon serve` (internal entry). Fails cleanly when a live daemon already
  answers `status`; stale socket files are removed before bind.
- `status` — probes `status` over IPC without starting a run.
- `stop` — asks the daemon to exit and unlinks the socket.

## Single-instance rule

A socket that answers `status` is the guard. No PID-file ownership. Stale socket
files (present on disk but not answering `status`) are removed before bind.

## Stop refusal

`stop` refuses while invocations are active and returns their run IDs in
`error.data.activeRunIds`. It succeeds when only non-active durable states remain
(paused, blocked, budget-soft-stopped, killed, failed, or done).

## Autostart (run-control clients)

Later run-control commands autostart the daemon when the socket is down:

- **Executable discovery** — prefer the `jarvis` wrapper path when invoked
  through it; otherwise `bun run <cli.ts> daemon serve`.
- **Readiness** — poll `status` until success or `DAEMON_READINESS_TIMEOUT_MS`
  (default 5s).
- **Detachment** — spawn with `detached: true` and `stdio: "ignore"`.
- **Failure reporting** — structured `{ reason, detail }` for
  `already_running`, `spawn_failed`, and `readiness_timeout`.

See [`autostart.ts`](../src/daemon/autostart.ts).

## Methods (current)

| Method | Result |
| --- | --- |
| `status` | `{ pid, socketPath, activeInvocationRunIds }` |
| `stop` | `{ stopped: true }` or `active_invocations` error |
| `log.tail` | Stream — see below |

Run control (`run.start`, `run.list`, steering) lands in later subspecs.

### `log.tail`

Params: `{ "runId": string, "fromSeq"?: number }`.

1. Replay stored records for `runId` with `seq > fromSeq` (or all when omitted)
   as stream frames: `{ "kind": "stream", "id", "event": "log.record", "data": <record> }`.
2. Follow live appends for the same run on the same request `id`.
3. On slow-consumer drop: `{ "event": "log.close", "data": { "reason": "slow_consumer" } }`
   then terminal `{ "ok": true, "result": { "closed": true, "reason": "slow_consumer" } }`.
4. Unknown `runId`: no replay; still follows later appends for that ID.

Request/response methods on the same socket continue while a tail is open.

Structured log storage and subscriber rules: [`structured-logging.md`](./structured-logging.md).

## Foreground write

`jarvis write` remains the foreground host until detached `start` lands. See
[`write-behavior.md`](./write-behavior.md).

## Verification

- `bun test v2/src/daemon/` — protocol, server, client, autostart, `log.tail`.
- `bun test v2/src/log-repository.test.ts` — append, replay, follow, slow-consumer drop.
- `bun test v2/src/cli.test.ts` — lifecycle CLI wiring.

Tests use temp `--jarvis-root` paths and write nothing under `~/.jarvis`.
