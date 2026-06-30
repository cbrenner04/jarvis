# 00 — TUI log tail client

Reusable IPC tail consumer for TUI slices: open a multiplexed log stream for a
run ID, parse `PersistedRecord` frames, replay in `seq` order, then follow live
appends. No ink rendering or CLI entry.

## Prerequisites

- Daemon IPC tail stream replays persisted records then follows live appends over
  `stream-open` / `stream-data` / `stream-end` (`v2/docs/daemon-host.md`).
- `connectIpcClient` transport and `TuiDaemonConnectionError` exist (`v2/src/ipc/client.ts`, `v2/src/tui-daemon-client.ts`).

## Decisions

- Dedicated tail client module consumed by later TUI slices — rules out shelling out to `jarvis run log` or inlining stream framing only in the view layer.
- Built on existing `connectIpcClient` transport and `TuiDaemonConnectionError` — rules out a new wire stack or plain `Error` for transport failures.
- Consumes daemon `stream-open` / `stream-data` / `stream-end` on one connection — rules out changing tail-stream server semantics.
- Exported `connectTuiLogTail` returns `TuiLogTailClient` with `records(): AsyncIterable<PersistedRecord>` and `close(): void` — rules out AsyncIterable-only factory with no abort seam or opaque handle without a cross-subspec contract.
- `records()` yields in server `stream-data` arrival order (passive; no client reorder) — rules out client-side sort or reorder before yield.
- Yields typed `PersistedRecord` from parsed `stream-data` JSON — rules out rendering free-text stderr or opaque blobs.
- Benign `stream-end` (no error payload) completes iteration — rules out treating all stream closes as errors.
- Error-payload `stream-end` (`{ error }`) rejects as `TuiDaemonConnectionError` — rules out benign empty completion on handler failure.
- Connection loss during `records()` iteration rejects as `TuiDaemonConnectionError` — rules out silent completion like `jarvis run log` on `connection closed`.
- `close()` sends `stream-end` for the opened stream and tears down transport — rules out leaving follow subscriptions open after the caller finishes.
- `socketPath` and `connectIpcClient` injectable; production default `~/.jarvis/daemon.sock` — rules out implicit socket discovery in library code.
- Malformed `stream-data` payload or unexpected frame shape rejects as `TuiDaemonConnectionError` — rules out skipping bad frames silently.
- Unknown or guard-rejected run (benign `stream-end` with no `stream-data`) yields an empty record sequence — rules out client-side `list` preflight or local log-file reads.
- Deferred to first consumer: sharing `parseStreamPayload` with `cli.ts` — pin if a second caller needs one implementation.

## Task checklist

- Add a co-located tail client under `v2/src` with injectable `connectIpcClient` and `socketPath` seams.
- Export `connectTuiLogTail` → `TuiLogTailClient` (`records`, `close`) per Decisions.
- Implement `stream-open` with `{ runId }`, iterate `stream-data` for the opened `streamId`, parse each payload as `PersistedRecord`.
- Honor benign `stream-end` as iteration completion; reject error-payload `stream-end` and connection loss as `TuiDaemonConnectionError`.
- Send `stream-end` on `close()`.
- Map socket connect failures, connection loss, malformed payloads, and unexpected frame kinds to `TuiDaemonConnectionError`.
- Co-locate tests with injectable IPC client fakes and fixture `PersistedRecord` sequences; socket-backed case uses production IPC tail framing (`createTailStreamHandler` path), not a reimplemented handler double.
- Doc-comment every exported symbol per `v2/docs/documentation-standard.md`.

## Acceptance criteria

- [ ] With an injectable IPC fake, opening tail for a run yields replayed then live `PersistedRecord`s in server `stream-data` arrival order until benign `stream-end`.
- [ ] With an injectable IPC fake, when the server sends benign `stream-end` without prior `stream-data`, the tail client yields no records and completes without error.
- [ ] With an injectable IPC fake, error-payload `stream-end` rejects with `TuiDaemonConnectionError`.
- [ ] With an injectable IPC fake, a malformed `stream-data` payload rejects with `TuiDaemonConnectionError`.
- [ ] With an injectable IPC fake, connection loss during `records()` iteration rejects with `TuiDaemonConnectionError`.
- [ ] With an injectable IPC fake, `close()` sends `stream-end` for the opened stream id.
- [ ] When the socket path is unreachable, the tail client rejects with `TuiDaemonConnectionError` before sending `stream-open`.
- [ ] When the caller omits `socketPath`, the tail client targets `~/.jarvis/daemon.sock`.
- [ ] Co-located tests inject a fake `connectIpcClient` and assert the client uses the injected transport (not production `connectIpcClient`).
- [ ] Co-located socket-backed test replays fixture records through production IPC tail framing, registered with `test.skipIf(!canUseUnixSockets(), ...)`.
- [ ] Every exported symbol in the tail client module has an inline doc-comment stating purpose, params, returns, and thrown errors.

## Documentation updates

- No operator-facing doc updates — internal client surface only; exported symbols documented inline per [`v2/docs/documentation-standard.md`](../../docs/documentation-standard.md).
