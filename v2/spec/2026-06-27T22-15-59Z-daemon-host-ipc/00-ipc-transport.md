# 00 — Typed IPC transport

Hermetic Unix-domain-socket transport: length-prefixed JSON frames carrying a
typed request/response envelope plus a multiplexed streaming slot (wire shape
only — no log/run payload semantics). Proves the channel with `health` and
`status` RPCs.

## Decisions

- Transport is a Unix domain socket; callers supply `socketPath` explicitly —
  rules out TCP, message broker, DB-as-bus, and an implicit production default
  before the CLI consumer pins one.
- Wire format is length-prefixed UTF-8 JSON frames on one connection — rules out
  newline-delimited text, shared-memory rings, and a second socket for streams.
- Messages are a discriminated union on `kind`: `request`, `response`, `error`,
  `stream-open`, `stream-data`, `stream-end` — rules out opaque byte pipes and
  HTTP-on-UDS.
- RPC envelopes: `request` carries `{ kind, id, method, params? }`; `response`
  carries `{ kind, id, result }`; `error` carries `{ kind, id, code, message }` —
  rules out ad-hoc per-method top-level fields with no shared shape.
- Request/response pairs correlate by `id`; `error` carries the same `id` when
  replying to a request — rules out fire-and-forget RPC with no correlation.
- Streaming multiplexes on the same connection via `stream-open` /
  `stream-data` / `stream-end` with `{ kind, streamId, payload? }` (`payload` is
  base64 bytes on `stream-data` only) — rules out a separate log socket and
  inventing log/run event shapes here.
- Streaming handler echoes each `stream-data` chunk back on the same `streamId`
  until `stream-end` — rules out ambiguous accumulate-vs-echo behavior.
- Framing failures (bad length, truncated body, invalid JSON) close the connection
  — rules out `error` replies without a parseable envelope.
- Semantic failures on otherwise valid JSON: missing/invalid `kind` closes the
  connection; unknown `method` returns an `error` frame with the request `id` —
  rules out mixed close-or-error handling per class.
- Listener accepts multiple simultaneous client connections (one socket per
  client; no per-client connection pool); no admission cap in this slice — rules
  out reading “one connection per client” as single-client-only.
- `health` and `status` are the only RPC methods in this slice — rules out
  run-control verbs (sibling intent).
- IPC `status` reports daemon-host liveness `{ state: "running" }` only — rules
  out run-orchestration status semantics (rename collision risk with a future
  run-control sibling).
- IPC server is a library-hosted listener startable in-process for tests — rules
  out requiring a detached daemon to exercise framing.
- Deferred to first consumer: default `socketPath` under `~/.jarvis`, stale-socket
  recovery, and max concurrent IPC clients cap — pin when CLI/TUI connect.

## Task checklist

- [ ] Add an IPC module under `v2/src` with typed frame encode/decode and the
  envelope shapes above.
- [ ] Unix socket listener: bind only at caller-supplied `socketPath`; accept
  multiple simultaneous connections.
- [ ] Dispatch `health` → `{ ok: true }` and `status` → `{ state: "running" }`
  on the in-process test server.
- [ ] Streaming slot: accept `stream-open`, echo `stream-data` chunks on the same
  `streamId`, honor `stream-end`.
- [ ] Framing failures close the connection; unknown `method` returns `error`;
  missing/invalid `kind` closes the connection.
- [ ] Co-located tests: round-trip RPC, stream echo with concurrent RPC, per-class
  malformed-frame handling; temp `socketPath` only (nothing under `~/.jarvis`).

## Acceptance criteria

- [ ] A Unix socket listener binds a caller-supplied `socketPath` and serves the
  pinned envelope shapes without network ports or external brokers.
- [ ] `health` request `{ kind: "request", id, method: "health" }` yields
  `response` `{ kind: "response", id, result: { ok: true } }`.
- [ ] `status` request `{ kind: "request", id, method: "status" }` yields
  `response` `{ kind: "response", id, result: { state: "running" } }` (daemon-host
  liveness only).
- [ ] Unknown `method` yields `error` `{ kind: "error", id, code, message }`
  correlated to the request `id`.
- [ ] A client can `stream-open`, send `stream-data` chunks (echoed back on the
  same `streamId`), and `stream-end` on the same connection as RPC traffic.
- [ ] RPC round-trips succeed while a stream is open; stream lifecycle does not
  break request/response `id` correlation.
- [ ] Bad length, truncated body, or invalid JSON closes the connection without
  crashing the server.
- [ ] Valid JSON with missing/invalid `kind` closes the connection without
  crashing the server.
- [ ] New code lives under `v2/**`/`shared/**` with no `v2 -> v1` imports.
- [ ] `bun run typecheck` (both tsconfigs) and `bun test` pass.

## Documentation updates

- [ ] New `v2/docs/daemon-host.md`: explicit `socketPath` policy (caller-supplied;
  production default deferred), frame envelope field shapes, `kind` union, RPC
  correlation, streaming echo contract, per-class malformed-frame outcomes,
  `health`/`status` contracts (daemon-host liveness; not run orchestration).
  Cross-link architecture Interface; do not restate steering or run-control verbs.
- [ ] `v2/docs/v1-behaviors.md`: no change — additive v2-only surface.
