# 01 - Structured per-run logs

Add the structured log substrate the daemon and later TUI consume: per-run
records that are appendable, replayable, and streamable live. This does not
change orchestration state or loop control.

## Decisions

- Store logs in a separate SQLite-backed log repository under
  `~/.jarvis/state/`, not in the `StateStore` API. Rules out mixing rich
  event/log history into the orchestration store that resume reads.
- First schema fields are `id`, `run_id`, `seq`, `ts`, `level`, `event`, and
  `data_json`. Rules out free-form text logs while avoiding a premature TUI
  schema.
- Sequence numbers are per run and monotonically increasing at append time.
  Rules out clients ordering live/replay records by wall-clock time.
- `tail` replays stored records from an optional sequence, then follows live
  appends. Rules out live-only logs that cannot reconstruct prior output.
- Log data is JSON payload attached to a typed event string; callers own event
  names at their boundary. Rules out a global event enum before consumers exist.

Deferred to first consumer: event taxonomy beyond daemon/run lifecycle events -
pin when the TUI or workflow view renders them.

## Task checklist

- [ ] Add a structured log module under `v2/src` with append, list/read, and
  follow subscription operations; exported symbols get doc-comments.
- [ ] Persist logs under `~/.jarvis/state/` by default; tests use temp overrides.
- [ ] Add daemon methods `log.tail` (replay + follow) and any needed internal
  append hook.
- [ ] Define streamed IPC frame shape for log records and terminal stream close.
- [ ] Add tests for append ordering, replay from sequence, live follow, and
  stream close.
- [ ] Emit daemon lifecycle log records where useful without logging transcripts
  or token/cost streams.

## Acceptance criteria

- [ ] A log repository in `v2/src` appends structured records keyed by run ID
  and returns per-run sequence-ordered records (test).
- [ ] Tests use a caller-supplied temp path and write nothing under
  `~/.jarvis`.
- [ ] `log.tail` over IPC replays prior records for a run and then streams live
  records appended after the tail starts (test).
- [ ] Tail supports resuming from an explicit sequence number without duplicating
  earlier records (test).
- [ ] Log records are structured JSON objects, not raw text lines; transcript
  bodies and token/cost streams are not stored.
- [ ] No `v2 -> v1` imports; `bun run typecheck` and `bun test` pass.

## Documentation updates

- [ ] `v2/docs/daemon.md`: add the `log.tail` method, stream frame shape, and
  replay/follow semantics.
- [ ] New `v2/docs/structured-logging.md`: storage location, minimal record
  fields, per-run sequence ordering, replay/follow behavior, and boundary from
  orchestration state.
- [ ] `v2/docs/v2-architecture.md`: update the Interface/logging note from
  "later" to the as-built structured stream, cross-linking
  `structured-logging.md`.
- [ ] `v2/docs/v1-behaviors.md`: no change - additive v2-only logging.
