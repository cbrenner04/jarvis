# 03 — Daemon tail-log over the IPC stream

The last verb: stream a run's structured log events to a client over the IPC
streaming channel. The log model and `tail`/`follow` reader already exist
(`v2/src/log-stream.ts`); the IPC stream channel exists but its server handler
only echoes `stream-data` back (`v2/src/ipc/server.ts`). Replace the echo with a
real handler that replays a run's `PersistedRecord`s and streams new appends as
stream frames until the client closes.

## Decisions

- Tail uses the existing streaming envelope (`stream-open` → `stream-data*` →
  `stream-end`), opened with the target run ID — rules out inventing a second
  stream mechanism.
- The handler backs the stream with the log reader's `follow(runId, signal)`:
  replay from seq 1, then stream new appends — rules out a snapshot-only `tail`
  that would miss events emitted after the client attaches to a live run.
- Each `PersistedRecord` is carried as one `stream-data` frame's payload — rules
  out batching records into one frame, which would defeat live following.
- Client disconnect / `stream-end` aborts the `follow` signal so the pump stops
  and frees resources — rules out a leaked follow loop after the client leaves.
- The `stream-open` payload carries the target run as a `runId: string` field;
  the rest of the wire encoding stays deferred to the CLI subspec — rules out
  leaving the handler with no parseable way to know which run to serve. The
  general encoding deferral does not cover this field.
- In-process tests may use working method/field names chosen by the implementer
  beyond the pinned `runId`; stable external names are deferred to the CLI
  subspec as first external caller.
- Tail of an unknown run ID is rejected; tail of a run with no further appends
  (e.g. terminal) replays persisted records then idles on the open stream until
  the client closes — rules out an error on a quiescent run or a snapshot that
  closes the stream prematurely.

## Task checklist

- Replace the echo `stream-data` behavior with a log-tail stream handler keyed on
  the `runId` field of `stream-open`; the existing echo test is superseded —
  delete or adapt it to the tail handler.
- On stream open, drive `follow(runId, signal)`, emitting each record as a
  `stream-data` frame; close with `stream-end`.
- Abort the `follow` signal on client disconnect / `stream-end`.
- Co-locate tests: existing events replay on attach, new appends arrive live,
  closing the stream stops the pump.

## Acceptance criteria

- [x] Opening a tail stream for a run replays its already-persisted log events in `seq` order.
- [x] Events appended after a client attaches to a live run arrive over the open stream.
- [x] Each log record arrives as its own stream frame (not batched).
- [x] Opening a tail stream for an unknown run ID is rejected.
- [x] Tail of a run with no further appends (e.g. terminal) replays its persisted records and leaves the stream open without error until the client closes.
- [x] Closing the stream (or client disconnect) stops the server-side follow pump.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — replace the "transport echoes each stream-data
  chunk" note with the log-tail stream semantics (stream-open carries a run ID;
  each record is one frame; close aborts follow).
- `v2/docs/v2-architecture.md` — Interface/Observability: record that tail is
  served over the IPC stream backed by the log reader's `follow`.
