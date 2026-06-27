# 00 — Typed IPC transport

Hermetic Unix-domain-socket transport: length-prefixed JSON frames carrying a
typed request/response envelope plus a multiplexed streaming slot (wire shape
only — no log/run payload semantics). Proves the channel with `health` and
`status` RPCs.

## Decisions

- Transport is a Unix domain socket under `~/.jarvis` with a caller-supplied
  path override for tests — rules out TCP, message broker, or DB-as-bus.
- Wire format is length-prefixed UTF-8 JSON frames on one connection — rules out
  newline-delimited text, shared-memory rings, and a second socket for streams.
- Messages are a discriminated union on `kind`: `request`, `response`, `error`,
  `stream-open`, `stream-data`, `stream-end` — rules out opaque byte pipes and
  HTTP-on-UDS.
- Request/response pairs correlate by `id`; `error` carries the same `id` when
  replying to a request — rules out fire-and-forget RPC with no correlation.
- Streaming multiplexes on the same connection via `stream-open` / `stream-data`
  / `stream-end` with opaque `streamId` + `payload` bytes (base64 on the wire)
  — rules out a separate log socket and inventing log/run event shapes here.
- `health` and `status` are the only RPC methods in this slice — rules out
  run-control verbs (sibling intent).
- IPC server is a library-hosted listener startable in-process for tests — rules
  out requiring a detached daemon to exercise framing.
- Deferred to first consumer: default socket filename under `~/.jarvis`, stale-
  socket recovery, and max concurrent IPC clients — pin when CLI/TUI connect.

## Task checklist

- [ ] Add an IPC module under `v2/src` with typed frame encode/decode and the
  `kind` discriminant union above.
- [ ] Unix socket listener: bind under `~/.jarvis` by default, path override for
  tests; accept one connection per client (no connection pool).
- [ ] Dispatch `health` → `{ ok: true }` (minimal liveness) and `status` →
  `{ state: "running" }` on the in-process test server.
- [ ] Implement streaming slot handlers: accept `stream-open`, echo or buffer
  `stream-data` chunks, honor `stream-end` — opaque bytes only.
- [ ] Return structured `error` frames for unknown methods and malformed requests.
- [ ] Co-located tests: round-trip RPC, stream multiplex, malformed-frame rejection;
  tests use a temp socket path and write nothing under `~/.jarvis`.

## Acceptance criteria

- [ ] A Unix socket listener binds a caller-supplied path and serves typed
  request/response frames without network ports or external brokers.
- [ ] `health` RPC returns `{ ok: true }`; `status` RPC returns `{ state:
  "running" }` when the server is up.
- [ ] Unknown RPC methods receive an `error` frame correlated to the request `id`.
- [ ] A client can open a stream (`stream-open`), send opaque `stream-data`
  chunks, and close (`stream-end`) on the same connection as RPC traffic.
- [ ] Malformed frames (bad length, invalid JSON, missing `kind`) close the
  connection or return an `error` without crashing the server (test).
- [ ] New code lives under `v2/**`/`shared/**` with no `v2 -> v1` imports.
- [ ] `bun run typecheck` (both tsconfigs) and `bun test` pass.

## Documentation updates

- [ ] New `v2/docs/daemon-host.md`: socket location policy (`~/.jarvis`, override
  for tests), frame envelope, `kind` union, RPC correlation, streaming slot wire
  shape, and the `health`/`status` contracts. Cross-link architecture Interface;
  do not restate steering or run-control verbs.
- [ ] `v2/docs/v1-behaviors.md`: no change — additive v2-only surface.
