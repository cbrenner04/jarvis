# 00 - `stream-open` carries an `afterSeq` resume cursor

## Problem

`stream-open` payload is `{ runId }` only. `streamRunLogRecords` replays every persisted
record from seq 1 on each open, so a re-opened tail can only produce duplicates. There is
no cursor a resuming client can pass.

## Decisions

- `stream-open` payload gains top-level `afterSeq: number` beside `runId`; rules out an ad-hoc cursor object or a per-`records()` argument.
- Absent, non-numeric, or negative `afterSeq` resolves to `0` (full replay); rules out failing the stream on a malformed cursor.
- The skip is server-side in `streamRunLogRecords`: replay yields only `seq > afterSeq`, and the follow subscribe seq is `max(last replayed seq, afterSeq)`; rules out client-side dedupe and rules out a stale subscribe seq when replay is fully skipped.
- `afterSeq` is an optional `ConnectTuiLogTailOptions` field on `connectTuiLogTail`, defaulting to `0`; rules out threading it through `records()`, since the client opens one stream per connection.

## Acceptance criteria

- [x] `stream-open` with `afterSeq: N` emits only records with `seq > N` and then follows live appends; a test in `v2/src/daemon/daemon-tail-stream.test.ts` fails against the current full-replay path.
- [x] `stream-open` without `afterSeq` (or with a non-numeric value) replays from the first record; existing `v2/src/daemon/daemon-tail-stream.test.ts` replay tests stay green.
- [x] `connectTuiLogTail` puts the caller-supplied `afterSeq` in its `stream-open` payload and `0` when unset; a test in `v2/src/tui/tui-log-tail-client.test.ts` fails against the current `{ runId }`-only payload.
- [x] Inverting the `seq <= afterSeq` skip guard fails a test in `v2/src/daemon/daemon-tail-stream.test.ts`, and inverting the follow subscribe-seq guard fails a test asserting a live append past a fully-skipped replay is emitted exactly once.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `stream-open` payload carries `afterSeq`; server-side skip semantics and the `0`/full-replay default.
