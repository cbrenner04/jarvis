# 01 - Structured per-run logs

Add the structured log substrate the daemon and later TUI consume: per-run
records that are appendable, replayable, and streamable live. This does not
change orchestration state or loop control.

## Decisions

- Store logs in a separate SQLite-backed log repository under
  `~/.jarvis/state/`, not in the `StateStore` API. Rules out mixing rich
  event/log history into the orchestration store that resume reads.
- The log repository owns its own bootstrap and forward-only migrations. Rules
  out piggybacking log schema on `v2.sqlite` state migrations.
- First schema fields are `id`, `run_id`, `seq`, `ts`, `level`, `event`, and
  `data_json`. Rules out free-form text logs while avoiding a premature TUI
  schema.
- Sequence numbers are per run and monotonically increasing at append time.
  Rules out clients ordering live/replay records by wall-clock time.
- `tail` replays stored records from an optional sequence, then follows live
  appends. Rules out live-only logs that cannot reconstruct prior output.
- `log.tail` accepts arbitrary run IDs, replaying empty history and following
  later appends. Rules out coupling the log substrate to detached run lifecycle.
- Live tail drops disconnected subscribers and isolates slow subscribers with
  bounded buffering or stream close. Rules out append latency depending on one
  client.
- Request/response and streaming frames must coexist on one socket. Rules out an
  untested multiplexing contract.
- Log data is JSON payload attached to a typed event string; callers own event
  names at their boundary. Rules out a global event enum before consumers exist.

Deferred to first consumer: event taxonomy beyond daemon/run lifecycle events -
pin when the TUI or workflow view renders them.

## Task checklist

- [x] Add a structured log module under `v2/src` with append, list/read, and
  follow subscription operations; exported symbols get doc-comments.
- [x] Persist logs under `~/.jarvis/state/` by default; tests use temp overrides.
- [x] Add daemon methods `log.tail` (replay + follow) and any needed internal
  append hook.
- [x] Define streamed IPC frame shape for log records and terminal stream close.
- [x] Add subscriber cleanup and slow-subscriber isolation.
- [x] Add tests for append ordering, replay from sequence, live follow, and
  stream close, including arbitrary run IDs with initially empty history.
- [x] Add an IPC test that issues normal request/response calls while a
  `log.tail` stream is open on the same socket.
- [x] Emit daemon lifecycle log records where useful without logging transcripts
  or token/cost streams.

## Acceptance criteria

- [x] A log repository in `v2/src` appends structured records keyed by run ID
  and returns per-run sequence-ordered records (test).
- [x] Tests use a caller-supplied temp path and write nothing under
  `~/.jarvis`.
- [x] `log.tail` over IPC replays prior records for a run and then streams live
  records appended after the tail starts (test).
- [x] `log.tail` accepts unknown run IDs, emits no historical records, and
  follows later appends for that ID (test).
- [x] Tail supports resuming from an explicit sequence number without duplicating
  earlier records (test).
- [x] Disconnected live-tail subscribers are cleaned up, and one slow subscriber
  cannot block appends to the log repository (test).
- [x] Request/response frames still work while a `log.tail` stream is active on
  the same socket (test).
- [x] Log records are structured JSON objects, not raw text lines; transcript
  bodies and token/cost streams are not stored.
- [x] No `v2 -> v1` imports; `bun run typecheck`, `bun test`, and
  `bun run ready` pass.

## Documentation updates

- [x] `v2/docs/daemon.md`: add the `log.tail` method, stream frame shape, and
  replay/follow semantics.
- [x] New `v2/docs/structured-logging.md`: storage location, minimal record
  fields, separate migration/bootstrap path, per-run sequence ordering,
  replay/follow behavior, subscriber cleanup/slow-consumer handling, and boundary
  from orchestration state.
- [x] `v2/docs/v2-architecture.md`: update the Interface/logging note from
  "later" to the as-built structured stream, cross-linking
  `structured-logging.md`.
- [x] `v2/docs/v1-behaviors.md`: no change - additive v2-only logging.
