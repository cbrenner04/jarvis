# 00 — TUI log tail client

Reusable IPC tail consumer for TUI slices: open a multiplexed log stream for a
run ID, parse `PersistedRecord` frames, replay in `seq` order, then follow live
appends. No ink rendering or CLI entry.

## Decisions

- Dedicated tail client module consumed by later TUI slices — rules out shelling out to `jarvis run log` or inlining stream framing only in the view layer.
- Built on existing `connectIpcClient` transport and `TuiDaemonConnectionError` — rules out a new wire stack or plain `Error` for transport failures.
- Consumes daemon `stream-open` / `stream-data` / `stream-end` on one connection — rules out changing tail-stream server semantics.
- Yields typed `PersistedRecord` from parsed `stream-data` JSON — rules out rendering free-text stderr or opaque blobs.
- Client sends `stream-end` and closes the transport on normal shutdown — rules out leaving follow subscriptions open after the caller finishes.
- `socketPath` and `connectIpcClient` injectable; production default `~/.jarvis/daemon.sock` — rules out implicit socket discovery in library code.
- Malformed `stream-data` payload or unexpected frame shape rejects as `TuiDaemonConnectionError` — rules out skipping bad frames silently.
- Unknown or guard-rejected run (server closes with no `stream-data`) yields an empty record sequence — rules out client-side `list` preflight or local log-file reads.
- Deferred to first consumer: sharing `parseStreamPayload` with `cli.ts` — pin if a second caller needs one implementation.

## Task checklist

- Add a co-located tail client under `v2/src` with injectable `connectIpcClient` and `socketPath` seams.
- Implement `stream-open` with `{ runId }`, iterate `stream-data` for the opened `streamId`, parse each payload as `PersistedRecord`.
- Honor `stream-end` for the opened `streamId` as stream completion; send `stream-end` on caller close/abort.
- Map socket connect failures, connection loss, malformed payloads, and unexpected frame kinds to `TuiDaemonConnectionError`.
- Co-locate tests with injectable IPC client fakes and fixture `PersistedRecord` sequences; socket-backed cases follow `v2/docs/test-writing.md` (`canUseUnixSockets`, `test.skipIf`).
- Doc-comment every exported symbol per `v2/docs/documentation-standard.md`.

## Acceptance criteria

- [ ] With an injectable IPC fake, opening tail for a run yields replayed `PersistedRecord`s in ascending `seq` order, then yields records from subsequent `stream-data` frames until `stream-end`.
- [ ] With an injectable IPC fake, when the server sends `stream-end` without prior `stream-data`, the tail client yields no records and completes without error.
- [ ] With an injectable IPC fake, a malformed `stream-data` payload rejects with `TuiDaemonConnectionError`.
- [ ] With an injectable IPC fake, closing the tail client sends `stream-end` for the opened stream id.
- [ ] When the socket path is unreachable, the tail client rejects with `TuiDaemonConnectionError` before sending `stream-open`.
- [ ] When the caller omits `socketPath`, the tail client targets `~/.jarvis/daemon.sock`.
- [ ] Co-located tests inject a fake `connectIpcClient` and assert the client uses the injected transport (not production `connectIpcClient`).
- [ ] Co-located tests include a socket-backed replay case registered with `test.skipIf(!canUseUnixSockets(), ...)`.
- [ ] Every exported symbol in the tail client module has an inline doc-comment stating purpose, params, returns, and thrown errors.

## Documentation updates

- No operator-facing doc updates — internal client surface only; exported symbols documented inline per [`v2/docs/documentation-standard.md`](../../docs/documentation-standard.md).
