# 00 - Allocate seq from the durable log

## Problem

`FileLogStream` (`v2/src/persistence/log-stream.ts`) snapshots per-run high-water marks once at
construction (`loadSequences()`) and never re-reads. The daemon keeps several sinks open on the same
`logs.jsonl` concurrently (reconciliation sink, per-write-loop sink, per-workflow sink, ad-hoc
failure-reporter sink). Two sinks live at once over the same run each allocate from a stale counter
and emit the same `seq` — observed as two `seq: 2` records for one run.

Duplicate `seq` corrupts every consumer that treats it as an ordering key: `tail()` sorts by it,
`follow()` advances with `record.seq > lastSeq`, and `wait` skips records at or below its subscribe
cursor. So a duplicated terminal `loop_finished` is silently swallowed and an in-flight `wait` hangs
until abort — the bug is operator-visible, not just a cosmetic log defect.

## Decisions

- Allocate `seq` inside `append()` by re-deriving the run's current max `seq` from the durable log file, not from a per-instance counter. Rules out the alternative of a process-wide in-memory registry keyed by storage path, which re-introduces a counter that can drift from the file.
- Delete the constructor-time `sequences` map/`loadSequences()` rather than keep it as a cache; a cache would need invalidation against other writers and is the bug being fixed.
- **Invariant an implementer must not break:** `append()` stays fully synchronous — read file → compute next seq → `appendFileSync`, with no `await` between the read and the write. That is what serializes allocation; any future `await` inserted there reintroduces this exact bug. No lock file.
- Cross-writer-*process* serialization is out of scope: all four `openLogSink` call sites are in the daemon process (`v2/src/daemon/daemon.ts` — failure reporter, workflow start, startup reconciliation, write-loop executor); the CLI never opens a sink and reads logs over IPC.
- Per-append cost is proportional to the *whole* `logs.jsonl`, not to one run: the storage path is a single global `~/.jarvis/state/logs.jsonl` covering every run the daemon has ever executed, and it grows without bound (no rotation exists). Accept it — `follow()` already calls `tail()`, a full read and parse of the same file, every 250 ms per active follower, so this adds no new cost class. Rotation/pruning is a separate intent; do not invent a bounded backward scan inside a correctness fix.
- Unparseable lines encountered by the read are skipped, not thrown on. Putting `JSON.parse` on the write path creates a new throw site mid-run (the write loop's iteration/boundary appends are unguarded); a truncated or partially-flushed trailing line is transient, not corruption.
- Pre-existing duplicate `seq` records in the operator's live log are not repaired — max-based allocation does not heal history, and the affected runs are terminal with no consumer re-reading them for control flow.
- Reader/`follow`/`tail` semantics are unchanged — `seq` stays 1-based and monotonic per run.

## Acceptance criteria

- [x] Two live sink instances on the same storage path — the second constructed *before* the first wrote (the daemon's reconciliation sink coexisting with a write-loop sink) — alternating `append()` calls for the same run produce distinct, monotonically increasing `seq` values (1, 2, 3, …) with no duplicates.
- [x] `seq` remains per-run: interleaved appends for two different runs each start at 1 and advance independently.
- [x] A log file whose trailing line is truncated/unparseable does not make `append()` throw; the appended record gets the next `seq` after the last parseable record for that run.
- [x] A run whose terminal event is appended by a second sink is observed by an in-flight `wait` (daemon level — the duplicate-`seq` swallow no longer hangs the waiter).
- [x] Existing `log-stream.test.ts` tests stay green (tail ordering, follow replay-then-stream, close/abort behavior unchanged).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — Observability section: state the `seq` uniqueness guarantee (unique and monotonic per run across concurrent writers on the same log) and that allocation reads the durable log at append time. This is the durable home for the log-stream contract; the intent's pointer at `v2/docs/state-store.md` is wrong — that doc deliberately excludes the observability log and stays untouched.
- `v2/src/persistence/log-stream.ts` — update the `LogSink.append` inline contract comment to state the guarantee.
