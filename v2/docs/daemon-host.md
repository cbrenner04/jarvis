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

| `method` | `result` | Meaning |
| --- | --- | --- |
| `health` | `{ ok: true }` | Channel liveness |
| `status` | `{ state: "running" }` | Daemon-host liveness only — not run orchestration status |

Unknown `method` returns `error` correlated to the request `id` (connection
stays open).

## Streaming

Streams multiplex on the same connection via `stream-open` / `stream-data` /
`stream-end`. The transport handler echoes each `stream-data` chunk back on the
same `streamId` until `stream-end`. No log or run event shapes are defined here.

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
