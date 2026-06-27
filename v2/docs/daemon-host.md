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

## Library surface

`startIpcServer(socketPath)` binds a Unix listener in-process (tests and future
daemon host). `connectIpcClient(socketPath)` is a thin test/caller helper.
Frame encode/decode lives in `v2/src/ipc/`.
