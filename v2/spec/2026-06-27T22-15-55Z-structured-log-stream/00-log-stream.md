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
- Events carry a monotonic per-run `seq` assigned at append time — rules out
  relying on wall-clock order alone for tail/follow cursors.
- Sink exposes append-only `append(runId, event)`; no update/delete — rules out
  mutable log rows.
- Reader exposes `tail` (snapshot of persisted events for a run) and `follow`
  (yields persisted events then blocks for new appends until closed/cancelled) —
  rules out an ad-hoc query language in this slice.
- Storage path is caller-injectable; default may live under `~/.jarvis` but
  tests must not write there — rules out hard-coding operator home in tests.
- Deferred to first consumer: on-disk retention, rotation, and compaction policy
  — pin when daemon or TUI needs it.
- Deferred to first consumer: exact sink medium (append-only file vs. SQLite
  table vs. hybrid) — pin in refine; injectable path suffices for tests.

### Event kinds (minimum vocabulary)

Pin only what 01 needs for boundary/iteration visibility:

| `kind` | When | Payload (minimum) |
| --- | --- | --- |
| `iteration_started` | Before each `executeWrite` call in the loop | `attemptId` |
| `boundary_committed` | After each transactional completion boundary | `attemptId`, `outcomeKind`, `runStatus` |
| `loop_finished` | Loop returns to caller | `loopOutcomeKind`, `iterationsConsumed`, `resumable` |

Deferred to first consumer: additional kinds (run lifecycle, agent stdout, token
streams) — pin when a surface reads them.

## Task checklist

- [ ] Add a log-stream module under `v2/src` exporting the event types, sink,
  and reader.
- [ ] Implement append with per-run `seq` assignment and ISO `ts` on each record.
- [ ] Implement `tail(runId)` returning events in `seq` order.
- [ ] Implement `follow(runId, signal?)` yielding persisted events then new
  appends; honour `AbortSignal` for clean shutdown.
- [ ] Co-located tests against injectable temp storage; no `v2 -> v1` imports.

## Acceptance criteria

- [ ] Appending events for a run persists structured records that round-trip the
  `kind` discriminator and kind-specific payload fields (test).
- [ ] `tail(runId)` returns only that run's events in ascending `seq` order
  (test, two runs interleaved).
- [ ] `follow(runId)` yields events already on disk, then yields events appended
  after subscribe, in order (test).
- [ ] `follow` stops without error when its `AbortSignal` aborts (test).
- [ ] Co-located tests use injectable temp paths and write nothing under
  `~/.jarvis`.
- [ ] No `v2 -> v1` imports; `bun run typecheck` and `bun test` pass.

## Documentation updates

- Inline doc-comments on exported symbols per `v2/docs/documentation-standard.md`.
- `v2/docs/v1-behaviors.md`: no change — additive v2-only code.
