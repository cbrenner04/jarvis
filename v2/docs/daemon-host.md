# Daemon host IPC

Hermetic Unix-domain-socket transport for the v2 daemon host. Wire shape only in
this slice — run orchestration verbs and log payload semantics land in sibling
work.

See [v2-architecture.md](./v2-architecture.md) Interface for daemon-first
placement; this doc pins the transport contract only.

## Socket path

Callers supply `socketPath` explicitly. There is no production default,
stale-socket recovery, or max concurrent client cap in the library yet — the
first CLI/TUI consumer pins those.

## Framing

One connection carries length-prefixed UTF-8 JSON frames:

1. Four-byte big-endian unsigned length of the JSON body.
2. UTF-8 JSON object body.

Framing failures — bad length (over cap), truncated body, invalid JSON — close
the connection. The listener keeps serving other clients.

## Envelope `kind` union

| `kind` | Role |
| --- | --- |
| `request` | RPC call: `{ kind, id, method, params? }` |
| `response` | RPC success: `{ kind, id, result }` |
| `error` | RPC failure: `{ kind, id, code, message }` |
| `stream-open` | Open multiplexed stream: `{ kind, streamId, payload? }` |
| `stream-data` | Stream chunk: `{ kind, streamId, payload? }` (`payload` is base64 bytes) |
| `stream-end` | Close stream: `{ kind, streamId, payload? }` |

Request/response pairs correlate by `id`. `error` carries the same `id` when
replying to a request.

Valid JSON with missing or invalid `kind` closes the connection.

## RPC methods (transport slice)

| `method` | `params` | `result` | Meaning |
| --- | --- | --- | --- |
| `health` | — | `{ ok: true }` | Channel liveness |
| `status` | — | `{ state: "running" }` | Daemon-host liveness only — not run orchestration status |
| `start` | `{ input: WriteLoopInput }` | `{ runId: string }` | Spawn a write loop in the background; returns immediately with run ID. Rejected if any run is in-flight (single in-flight guard) or if a run is active for the same `(project, branch)` (per-key guard). |
| `list` | — | `{ runs: Array<{runId, project, branch, status, isLive}> }` | List durable runs merged with in-memory liveness; `isLive=true` only while the loop's Promise is executing. |
| `pause` | `{ runId: string }` | `{ ok: true }` | Signal graceful pause for an active run. The run continues at the next iteration boundary (in-flight step is not aborted). Rejected if run is unknown or not active. |
| `kill` | `{ runId: string }` | `{ ok: true }` | Abort the run's signal immediately and record durable status `killed`. Leaves the worktree dirty. Rejected if run is unknown or not active. |
| `resume` | `{ runId: string }` | `{ ok: true }` | Resume a paused/killed run, re-invoking `executeWriteLoop` under the start guards. A paused run continues with a fresh attempt; a killed run re-runs the interrupted step. Rejected if run is unknown, in terminal status, or if another run is active (single in-flight guard or per-key guard violation). |

Unknown `method` returns `error` correlated to the request `id` (connection
stays open).

### Admission guards for `start`

1. **Single in-flight run:** At most one run loop can be active globally. A `start` request when any loop is executing is rejected with `code: "run_in_progress"`.

2. **Per-`(project, branch)` key:** No overlapping runs for the same project and branch. A `start` for an already-claimed key is rejected with `code: "worktree_claimed"`.

## Streaming

Streams multiplex on the same connection via `stream-open` / `stream-data` /
`stream-end`. The `stream-open` payload carries `{ runId: string }` to identify
the run. The server replays the run's persisted log records in `seq` order, then
streams new appends as `stream-data` frames — one record per frame — until the
client closes with `stream-end` or the connection drops. Each record is a
`PersistedRecord` serialized as JSON in the `payload` field.

RPC traffic on the same connection keeps `id` correlation while a stream is
open.

## Daemon lifecycle API

The daemon is a detached child process. Callers interact via three programmatic
functions in `v2/src/daemon-lifecycle.ts`.

### `startDaemon(socketPath, options?)`

Spawns a detached child running `v2/src/daemon.ts`. Returns metadata `{pid,
socketPath}` or throws on startup failure.

**Injected paths:** Callers must supply an explicit `socketPath`; the daemon
environment variable is `DAEMON_SOCKET_PATH`. Tests may inject `pidPath` (for
cleanup); `daemonScript` (test override); and `readinessTimeoutMs` (default
5s).

**Double-start protection:** If the socket already responds to `health`, throws
`DaemonAlreadyRunningError` (no second child spawned).

**Readiness:** Polls the socket for `health` response. Throws
`DaemonReadinessTimeoutError` if the child is alive but socket doesn't respond
within `readinessTimeoutMs`.

### `stopDaemon(socketPath, options?)`

Graceful shutdown: attempts RPC `shutdown` (for coordinated drain), sends
SIGTERM, waits bounded time, then SIGKILL if needed. Cleans up injected
`pidPath`.

**Drain:** Signals server to reject new connections and drain in-flight IPC
(default 2s). Waits bounded time (default 3s) for process exit after SIGTERM.

**Process-only fallback:** If socket is unreachable, signals the process
directly. If `pidPath` is not provided, external signal handling is required.

### `getDaemonStatus(pid, socketPath, options?)`

Returns `"running"` only if process is alive AND socket responds to `health` in
short timeout (default 1s). Returns `"stopped"` on any liveness or transport
failure.

**Probe order:** Process liveness first (no socket I/O if dead). Prevents false
"running" states from stale sockets.

## In-memory worktree ownership

The daemon holds a registry keyed by `{ project: string, branch: string }`.
Each entry records `{ runId, worktreePath }`.

**Registry methods:**
- `claim(key, ownership)` — acquires ownership; throws `DaemonDoubleClaimError`
  on double-claim (no overwrite).
- `release(key)` — releases ownership; no-op if key not held.
- `get(key)` — returns ownership or undefined.
- `isClaimed(key)` — boolean test.

**No disk writes:** Registry is in-memory only. Cross-process coordination uses
`.jarvis.lock` and git worktrees locking (unchanged).

## Library surface

`startIpcServer(socketPath, handlers?)` binds a Unix listener in-process (tests
and daemon host). Custom RPC handlers override built-in `health`/`status` if
provided. `connectIpcClient(socketPath)` is a thin test/caller helper.
Frame encode/decode lives in `v2/src/ipc/`.
