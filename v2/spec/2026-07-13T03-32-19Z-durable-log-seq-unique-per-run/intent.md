---
name: durable-log-seq-unique-per-run
---

# `seq` is unique per run in the durable log

Two concurrent writers (the reconciler's log sink and the run's own sink) each keep an
in-memory `sequences` map (`v2/src/persistence/log-stream.ts`), so both emitted `seq: 2` for
the same run. Duplicate sequence numbers are a durable-log integrity bug independent of the
race that exposed them.

Make `seq` unique per run across concurrent writers — allocation must be serialized against
the durable log, not against one sink's in-memory counter. Concurrent appends to the same run
get distinct, monotonic `seq` values; readers/tail keep working unchanged.

## Documentation updates

- `v2/docs/state-store.md` — `seq` uniqueness guarantee.

## Prerequisites
