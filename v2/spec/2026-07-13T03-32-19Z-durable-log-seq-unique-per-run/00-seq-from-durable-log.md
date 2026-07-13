# 00 - Allocate seq from the durable log

## Problem

`FileLogStream` (`v2/src/persistence/log-stream.ts`) snapshots per-run high-water marks once at
construction (`loadSequences()`) and never re-reads. The daemon keeps several sinks open on the same
`logs.jsonl` concurrently (reconciliation sink, per-write-loop sink, per-workflow sink, ad-hoc
failure-reporter sink). Two sinks live at once over the same run each allocate from a stale counter
and emit the same `seq` — observed as two `seq: 2` records for one run.

Duplicate `seq` corrupts every consumer that treats it as an ordering key: `tail()` sorts by it,
`follow()` advances with `record.seq > lastSeq` (so it silently drops the duplicate), and `wait`
subscribes from a captured cursor `seq`.

## Decisions

- Allocate `seq` inside `append()` by re-deriving the run's current max `seq` from the durable log file, not from a per-instance counter. Rules out the alternative of a process-wide in-memory registry keyed by storage path, which re-introduces a counter that can drift from the file.
- Delete the constructor-time `sequences` map/`loadSequences()` rather than keep it as a cache; a cache would need invalidation against other writers and is the bug being fixed.
- Serialization comes from `append()` being fully synchronous (read file → compute next seq → `appendFileSync`) with no `await` inside. No lock file. The daemon process is the only writer in production; cross-writer-process serialization is out of scope.
- Accept the O(log-file) read per append. Runs emit a handful of events; correctness over a speculative cache.
- Reader/`follow`/`tail` semantics are unchanged — `seq` stays 1-based and monotonic per run.

## Acceptance criteria

- [ ] Two sinks opened concurrently on the same storage path, appending interleaved events for the same run, produce records with distinct, monotonically increasing `seq` values (1, 2, 3, …) — no duplicates.
- [ ] A sink opened on a storage path that already contains records for a run continues that run's `seq` from the persisted max, including when those records were written by a different sink after this sink was constructed.
- [ ] `seq` remains per-run: interleaved appends for two different runs each start at 1 and advance independently.
- [ ] Existing `log-stream.test.ts` tests stay green (tail ordering, follow replay-then-stream, close/abort behavior unchanged).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — Observability section: state the `seq` uniqueness guarantee (unique and monotonic per run across concurrent writers on the same log) and that allocation reads the durable log at append time. This is the durable home for the log-stream contract; the intent's pointer at `v2/docs/state-store.md` is wrong — that doc deliberately excludes the observability log and stays untouched.
- `v2/src/persistence/log-stream.ts` — update the `LogSink.append` inline contract comment to state the guarantee.
