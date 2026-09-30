# Monthly rolling telemetry JSONL sink

## Problem

`buildJsonlSink` and `emitWorkBoundaryRecorded` append forever to a single JSONL file with no month boundary, so the analysis-fact store never closes a month.

## Decisions

- Current writable file stays the injectable path (default `join(jarvisHome(), "telemetry.jsonl")`); closed months land as `join(dirname(currentPath), "telemetry", "<YYYY-MM>.jsonl.gz")` where `<YYYY-MM>` is the existing current file's UTC calendar month from its `mtime` at roll time — rules out clock-month naming when the file's mtime month differs and rules out archives colocated as `telemetry-<month>.jsonl.gz` beside the current file without a `telemetry/` directory.
- Roll month bucketing uses UTC getters on the current file's `mtime` (`getUTCFullYear`, `getUTCMonth`) and on the injectable clock — rules out local-timezone month labels and TZ-flaky tests.
- Roll runs synchronously immediately before each append when the current file exists and its UTC `mtime` month differs from the injectable clock's UTC month — rules out background timers and rules out rolling only at process startup without an append.
- A roll gzip-compresses the entire current plain file, writes via a temp sibling, atomically renames into `telemetry/<YYYY-MM>.jsonl.gz`, removes the plain current file, then the append creates a fresh current file — rules out truncating in place and rules out keeping both plain and gzip for the same month.
- After each append the helper sets the current file's `atime`/`mtime` to the injected clock via `utimesSync` — keeps `mtime`-month bucketing consistent with the clock, so injected-clock tests never roll on a real-vs-clock month mismatch.
- Legacy first roll: a pre-existing multi-month `telemetry.jsonl` is archived whole under its `mtime` month, so that first archive may hold earlier months' rows — documented only; rules out migration or row splitting.
- Roll gzips synchronously in the appending process; the first legacy roll (~60 MB) is a one-time blocking cost — documented only; rules out async/streaming compression.
- Skipped UTC months produce no archive file — rules out empty placeholder gzip objects for months with no writes.
- Repeated appends within the same UTC month append to one current file without re-rolling — rules out rolling on every append.
- One shared roll-then-append helper backs `buildJsonlSink` and `work_boundary_recorded` emission — rules out independent roll logic in `work-boundary-telemetry.ts`.
- `clock` and sink path remain injectable on the shared helper / sink factory (default clock: real time) — rules out ambient-only tests.
- Deferred to first consumer: crash recovery when plain current file and a same-month `telemetry/<YYYY-MM>.jsonl.gz` both exist — pin when an operator reports a partial roll.
- Deferred to first consumer: concurrent writers rolling the same current file — pin when multi-process telemetry is required.
- Deferred to first consumer: target `telemetry/<YYYY-MM>.jsonl.gz` already exists at roll time — pin when duplicate-month roll is reported.

## Task checklist

- [ ] Add monthly roll-then-append in `v2/src/execution/telemetry-sink.ts` with injectable `clock` and export the helper used by both producers.
- [ ] Route `emitWorkBoundaryRecorded` through the shared helper instead of direct `appendFileSync` on the sink path.
- [ ] Add `v2/src/execution/telemetry-sink.test.ts` with `JARVIS_HOME` isolation and injected clock covering same-month append without re-roll, one-time month-boundary roll, restarted writer roll from existing file `mtime`, skipped-month roll naming, gzip round-trip readability, and both `buildJsonlSink` and work-boundary append paths.
- [ ] Update `v2/docs/telemetry-capture.md` for current vs closed-month layout, roll boundary, indefinite closed-month retention, legacy multi-month first archive, synchronous gzip, and injectable sink/clock contract.

## Acceptance criteria

- [ ] `v2/src/execution/telemetry-sink.test.ts` test `monthly telemetry same UTC month appends without re-roll` pins, with an injected clock in a month other than the real one, that multiple appends in one injected UTC month leave one current file whose `mtime` equals the injected clock, no `telemetry/<YYYY-MM>.jsonl.gz`, and no roll; fails against a roll that buckets by real filesystem `mtime` without the `utimesSync` stamp.
- [ ] `v2/src/execution/telemetry-sink.test.ts` test `monthly telemetry roll on UTC boundary` fails against the unbounded `buildJsonlSink` and pins one gzip archive named from the prior file's UTC `mtime` month, a new empty-boundary current file receiving the post-roll append, and gzip contents matching the pre-roll lines.
- [ ] `v2/src/execution/telemetry-sink.test.ts` test `monthly telemetry roll after writer restart` fails against the unbounded sink and pins roll from an on-disk current file whose UTC `mtime` month lags the injected clock without requiring a prior in-test append in the same process.
- [ ] `v2/src/execution/telemetry-sink.test.ts` test `monthly telemetry skipped months produce no archive` fails against roll-on-clock-month naming and pins no `telemetry/<YYYY-MM>.jsonl.gz` for months with no rows when the clock jumps multiple UTC months.
- [ ] `v2/src/execution/telemetry-sink.test.ts` test `work boundary and invocation sinks share monthly roll` fails while work-boundary bypasses the shared helper and pins identical roll behavior for `buildJsonlSink` and `emitWorkBoundaryRecorded` against the same sink path and clock.
- [ ] `v2/docs/telemetry-capture.md` documents `telemetry.jsonl`, `telemetry/<YYYY-MM>.jsonl.gz`, UTC `mtime` month naming, legacy multi-month first archive, synchronous gzip, skipped months, injectable path/clock, and that closed months are not cleanup-deleted (cross-link operator runbook).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — per task checklist (owned here).
