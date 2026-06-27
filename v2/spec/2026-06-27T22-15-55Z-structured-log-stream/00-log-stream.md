# 00 — Log event model, sink, and reader

Stand up the structured log stream library: typed events keyed by run ID, an
append sink hosts write during execution, and a reader with tail and follow.
Exercised via direct sink/reader calls and temp/injectable storage paths — no
write-loop wiring (01) and no real agent bindings.

## Decisions

- Events are structured records with a discriminated `kind` field, not
  printf-style log lines — rules out mirroring v1 stderr as the contract.
- `runId` is on every event and is the reader's sole query key — rules out
  project-only or global undifferentiated streams.
- Events carry a monotonic per-run `seq` starting at `1` on first append,
  assigned at append time — rules out relying on wall-clock order alone for
  tail/follow cursors and rules out 0-based sequences.
- Every persisted record carries `ts` as ISO-8601 wall time at append — rules
  out omitting timestamps or non-ISO formats.
- Sink exposes append-only `append(runId, event)`; no update/delete — rules out
  mutable log rows.
- Sink is opened explicitly (`openLogSink` or equivalent); `close()` flushes and
  releases resources; idempotent `close()` is safe — rules out implicit
  process-exit cleanup as the only lifecycle.
- `follow` on a closed writer still replays persisted events and blocks for new
  appends from a later writer on the same storage path — rules out tying follow
  lifetime to a single open sink handle.
- Reader exposes `tail` (snapshot of persisted events for a run) and `follow`
  (replays from the beginning, then blocks for new appends until
  closed/cancelled) — rules out an ad-hoc query language or offset/cursor API in
  this slice.
- Unknown or empty `runId`: `tail` and `follow` yield an empty stream, not an
  error — rules out erroring on missing runs (matches state-store posture).
- Single writer per `runId` on the sink; concurrent append from multiple writers
  is out of scope — rules out cross-process writer coordination in 00.
- Log stream is a separate injectable artifact, not rows in `v2.sqlite` — rules
  out colocating observability events in the orchestration store even if the
  implementation uses SQLite on disk elsewhere.
- `append` failures throw to the caller; no silent drop — rules out best-effort
  swallow at the sink boundary.
- Storage path is caller-injectable; default may live under `~/.jarvis` but
  tests must not write there — rules out hard-coding operator home in tests.
- Deferred to first consumer: on-disk retention, rotation, and compaction policy
  — pin when daemon or TUI needs it.
- Deferred to first consumer: exact sink medium (append-only file vs. SQLite
  table vs. hybrid) — pin in refine; injectable path suffices for tests.
- Deferred to first consumer: cross-process `follow` wake — pin in Phase 3
  daemon refine before daemon tail ships; in-process proofs in 00 suffice for
  this slice.

### Event kinds (minimum vocabulary)

Pin only what 01 needs for boundary/iteration visibility. Payload field types
reuse `OutcomeKind` and `RunStatus` from the state store and
`WriteLoopOutcomeKind` from the write loop. Terminal `boundary_committed`
`outcomeKind` / `runStatus` pairs must match `terminalMapping` in
`write-loop.ts` (not a parallel taxonomy).

| `kind` | When | Payload (minimum) |
| --- | --- | --- |
| `iteration_started` | Before each `executeWrite` call in the loop | `attemptId: string` |
| `boundary_committed` | After each transactional completion boundary succeeds | `attemptId: string`, `outcomeKind: OutcomeKind`, `runStatus: RunStatus` |
| `loop_finished` | Loop returns to caller | `loopOutcomeKind: WriteLoopOutcomeKind`, `iterationsConsumed: number`, `resumable: boolean` |

Terminal `boundary_committed` mapping (same as `terminalMapping`):

| step result | `outcomeKind` | `runStatus` | `loop_finished.loopOutcomeKind` |
| --- | --- | --- | --- |
| `complete` (`done`) | `"done"` | `"completed"` | `"complete"` |
| `complete` (`no-work`) | `"no-work"` | `"completed"` | `"complete"` |
| `blocked` | `"blocked"` | `"blocked"` | `"blocked"` |
| `contract_miss` | `"contract_miss"` | `"blocked"` | `"contract_miss"` |
| `invocation_failure` | `"invocation_failure"` | `"failed"` | `"invocation_failure"` |
| progress (non-terminal) | `"progress"` | `"in-progress"` | — |
| budget soft-stop (no terminal boundary) | — | — | `"budget-exhausted"` |

Deferred to first consumer: additional kinds (run lifecycle, agent stdout, token
streams) — pin when a surface reads them.

## Task checklist

- [ ] Add a log-stream module under `v2/src` exporting the event types, sink,
  and reader.
- [ ] Implement open/close lifecycle with idempotent `close`.
- [ ] Implement append with per-run `seq` (from `1`) and ISO-8601 `ts` on each
  record.
- [ ] Implement `tail(runId)` returning events in `seq` order.
- [ ] Implement `follow(runId, signal?)` replaying from the beginning, then
  yielding new appends; honour `AbortSignal` for clean shutdown.
- [ ] Co-located tests against injectable temp storage; no `v2 -> v1` imports.

## Acceptance criteria

- [x] Appending events for a run persists structured records that round-trip the
  `kind` discriminator and kind-specific payload fields (test).
- [x] `tail(runId)` returns only that run's events in ascending `seq` order
  starting at `1` (test, two runs interleaved).
- [x] `follow(runId)` yields events already on disk from `seq` 1, then yields
  events appended after subscribe, in order (test).
- [x] `follow` stops without error when its `AbortSignal` aborts (test).
- [x] `tail` and `follow` on an unknown `runId` yield an empty stream without
  error (test).
- [x] `follow` after the writer `close()` still replays persisted events (test).
- [x] Co-located tests use injectable temp paths and write nothing under
  `~/.jarvis`.
- [x] No `v2 -> v1` imports; `bun run typecheck` and `bun test` pass.

## Documentation updates

- Inline doc-comments on exported symbols per `v2/docs/documentation-standard.md`.
- `v2/docs/v1-behaviors.md`: no change — additive v2-only code.
