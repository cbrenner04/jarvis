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
active invocation run IDs). `jarvis status` reports run snapshots from durable
state plus daemon in-memory activity — different scope, different command.

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

## Run-control commands

```
jarvis start --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--agents <csv>] [--max-iterations <n>] [--jarvis-root <path>]
jarvis status [--jarvis-root <path>]
jarvis log-tail <run-id> [--from-seq <n>] [--jarvis-root <path>]
```

| CLI | IPC method |
| --- | --- |
| `start` | `run.start` |
| `status` | `run.list` |
| `log-tail` | `log.tail` |

- `start` — accepts the same write-loop fields as `jarvis write`; returns a run
  ID after durable run creation and async scheduling (does not wait for loop
  completion).
- `status` — prints durable run snapshots with an `active` flag for in-flight
  daemon invocations plus `activeRunIds`.
- `log-tail` — replays stored records for the run, then streams live appends as
  JSON lines on stdout until interrupted.

Run-control commands autostart the daemon when the socket is unreachable (see
**Autostart**). Lifecycle commands remain explicit — they do not autostart.

## Single-instance rule

A socket that answers `status` is the guard. No PID-file ownership. Stale socket
files (present on disk but not answering `status`) are removed before bind.

## Stop refusal

`stop` refuses while invocations are active and returns their run IDs in
`error.data.activeRunIds`. It succeeds when only non-active durable states remain
(paused, blocked, budget-soft-stopped, killed, failed, or done).

## Autostart (run-control clients)

`start`, `status`, and `log-tail` autostart the daemon when the socket is down:

- **Executable discovery** — prefer the `jarvis` wrapper path when invoked
  through it; otherwise `bun run <cli.ts> daemon serve`.
- **Readiness** — poll `status` until success or `DAEMON_READINESS_TIMEOUT_MS`
  (default 5s).
- **Detachment** — spawn with `detached: true` and `stdio: "ignore"`.
- **Failure reporting** — structured `{ reason, detail }` for
  `already_running`, `spawn_failed`, and `readiness_timeout`.

See [`autostart.ts`](../src/daemon/autostart.ts).

## Daemon-owned worktree ownership

The daemon enforces at most one daemon-owned run per `(project, branch)` in
memory. Ownership is reserved when a detached start is accepted and held while
durable status is nonterminal: `in-progress`, `paused`, `blocked`,
`budget-soft-stopped`, or `killed`. It releases on terminal `completed` or
`failed`, or after explicit cleanup (steering subspec).

On startup the daemon rebuilds ownership guards from durable nonterminal runs so
paused/killed exclusivity survives restarts. Conflicting `run.start` calls return
`ownership_conflict` with the existing run ID before any worktree is shared.

## Methods

| Method | Result |
| --- | --- |
| `status` | `{ pid, socketPath, activeInvocationRunIds }` |
| `stop` | `{ stopped: true }` or `active_invocations` error |
| `run.start` | `{ runId }` or `ownership_conflict` / param errors |
| `run.list` | `{ runs: RunListEntry[], activeRunIds }` |
| `log.tail` | Stream — see below |

Steering (`run.pause`, `run.resume`, `run.kill`) lands in a later subspec.

### `run.start`

Params mirror `jarvis write` / `jarvis start` CLI fields:

```json
{
  "projectRoot": "/path/to/repo",
  "project": "name",
  "branch": "branch-name",
  "base": "HEAD",
  "spec": "spec.md",
  "artifact": "proof.txt",
  "agents": ["claude"],
  "maxIterations": 10
}
```

Returns `{ "runId": "<uuid>" }` after durable run creation (or resume-key lookup)
and scheduling `executeWriteLoop` asynchronously. Emits structured log records:
`run.accepted`, `run.started`, `run.iteration`, and `run.finished` or
`run.failed`.

### `run.list`

No params. Returns all durable run rows (newest first) with fields
`id`, `project`, `branch`, `status`, `createdAt`, `attemptCount`, `specPath`,
`worktreePath`, and `active` (true when the daemon is currently executing that
run). Also returns `activeRunIds` for convenience.

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

`jarvis write` remains the foreground debug path. Detached runs use `jarvis start`.
See [`write-behavior.md`](./write-behavior.md).

## Verification

- `bun test v2/src/daemon/` — protocol, server, client, autostart, run control,
  `log.tail`.
- `bun test v2/src/log-repository.test.ts` — append, replay, follow, slow-consumer drop.
- `bun test v2/src/cli.test.ts` — lifecycle and run-control CLI wiring.

Tests use temp `--jarvis-root` paths and write nothing under `~/.jarvis`.
