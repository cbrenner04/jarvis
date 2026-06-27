# 01 — Write loop emission

Wire `executeWriteLoop` to append boundary/iteration events into the log sink
(00) for the active run. Proven via injected test bindings; no daemon, IPC, or
real agent bindings.

## Decisions

- `executeWriteLoop` accepts an optional log sink; when omitted, logging is a
  no-op — rules out requiring a sink for existing CLI callers.
- The loop appends directly; no separate log-agent subprocess — rules out an
  agent subprocess for logging.
- Emit `iteration_started` immediately before each `executeWrite` call (including
  a kill/crash resume re-run of the interrupted attempt).
- Emit `boundary_committed` only after the state store's transactional boundary
  succeeds — rules out logging a boundary that rolled back.
- Emit `loop_finished` once with the returned `WriteLoopResult` fields — rules
  out omitting terminal/soft-stop visibility.
- Idempotent re-entry that returns an already-committed terminal result emits no
  new iteration events — rules out duplicate boundary noise on finished runs.
- Deferred to first consumer: default sink path wiring for production hosts —
  pin when daemon host is the caller.

## Task checklist

- [ ] Thread an optional log sink through `WriteLoopInput`.
- [ ] Emit the three event kinds from 00 at the points above.
- [ ] Extend co-located write-loop tests to assert event sequences for: multi-
  iteration progress→terminal, budget soft-stop, kill/crash resume re-run, and
  idempotent terminal re-entry.
- [ ] Update `v2/docs/v2-architecture.md` Interface logging bullets per
  documentation updates below.

## Acceptance criteria

- [ ] A multi-iteration loop run produces `iteration_started` and
  `boundary_committed` pairs in order, ending with `loop_finished` matching the
  returned outcome (test, injected bindings).
- [ ] Budget soft-stop emits `loop_finished` with `resumable: true` and no extra
  iteration after the soft-stop boundary (test).
- [ ] Kill/crash resume re-run emits a fresh `iteration_started` for the
  interrupted attempt before re-invoking the step (test).
- [ ] Re-invoking a run whose terminal boundary is already committed returns the
  prior outcome without appending new log events (test).
- [ ] Omitting the log sink leaves loop behavior unchanged — `write-loop.test.ts`
  green without a sink (behavior unchanged by optional logging).
- [ ] No `v2 -> v1` imports; `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` (Interface): replace "Logs need improvement, but
  later" with the settled event kinds (`iteration_started`, `boundary_committed`,
  `loop_finished`), run-ID query key, append sink + tail/follow reader contract,
  and note that the write loop emits directly. Cross-link inline contracts on the
  log-stream exports.
- `v2/docs/v1-behaviors.md`: no change — additive v2-only code.
