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
  kill/crash resume re-run and mid-boundary retry with the same `attemptId`) —
  rules out deduplicating `iteration_started` by `attemptId`.
- Emit `boundary_committed` only after the state store's transactional boundary
  succeeds — rules out logging a boundary that rolled back.
- Emit `loop_finished` once with the returned `WriteLoopResult` fields — rules
  out omitting terminal/soft-stop visibility.
- Budget soft-stop calls `setRunStatus` only; no terminal `boundary_committed`.
  Last committed boundary before soft-stop is progress with
  `runStatus: "in-progress"`. Terminal visibility is solely `loop_finished`
  (`loopOutcomeKind: "budget-exhausted"`, `resumable: true`) — rules out a
  terminal boundary on soft-stop.
- Abort checked at iteration top (before `iteration_started`). Mid-step abort
  completes the in-flight step, commits a progress `boundary_committed`, then
  exits on the next iteration check with `loopOutcomeKind: "progress"` — rules
  out orphan `iteration_started` without a matching boundary.
- Mid-boundary rollback (distinct from kill/crash resume): `iteration_started`,
  failed boundary (no `boundary_committed`), retry with same `attemptId` and a
  fresh `iteration_started`, then success `boundary_committed` — rules out
  logging a rolled-back boundary.
- Idempotent re-entry that returns an already-committed terminal result appends
  zero events of any kind, including no `loop_finished` — rules out duplicate
  terminal noise on finished runs.
- `append` throws propagate; loop aborts — rules out best-effort swallow that
  drops boundary visibility.
- Deferred to first consumer: default sink path wiring for production hosts —
  pin when daemon host is the caller.

## Task checklist

- [ ] Thread an optional log sink through `WriteLoopInput`.
- [ ] Emit the three event kinds from 00 at the points above.
- [ ] Extend co-located write-loop tests to assert event sequences for: multi-
  iteration progress→terminal, each distinct terminal outcome kind, budget
  soft-stop, soft-stop resume continuation, kill/crash resume re-run, mid-
  boundary rollback retry, abort/cancellation, idempotent terminal re-entry, and
  append failure propagation.
- [ ] Update `v2/docs/v2-architecture.md` per documentation updates below.

## Acceptance criteria

- [ ] A multi-iteration loop run produces `iteration_started` and
  `boundary_committed` pairs in order, ending with `loop_finished` matching the
  returned outcome (test, injected bindings).
- [ ] Terminal `boundary_committed` and `loop_finished` payloads match
  `terminalMapping` for each distinct terminal path: `blocked`, `contract_miss`,
  `invocation_failure`, and `no-work` (`outcomeKind: "no-work"`,
  `loopOutcomeKind: "complete"`) (test, parameterized or per-kind).
- [ ] Budget soft-stop emits no terminal `boundary_committed`; the last
  `boundary_committed` before `loop_finished` has `outcomeKind: "progress"` and
  `runStatus: "in-progress"`; `loop_finished` has `loopOutcomeKind:
  "budget-exhausted"` and `resumable: true` (test).
- [ ] A second invocation on a budget-soft-stopped `runId` appends new events to
  the existing stream without idempotent suppression (test, mirrors
  `a budget-soft-stopped run resumes with a fresh per-invocation budget`).
- [ ] Kill/crash resume re-run emits a fresh `iteration_started` for the
  interrupted attempt (same `attemptId`) before re-invoking the step (test).
- [ ] Mid-boundary rollback emits `iteration_started`, no `boundary_committed` on
  the failed attempt, a second `iteration_started` with the same `attemptId`,
  then success `boundary_committed` (test, mirrors
  `re-running a boundary that fails mid-transaction retries the same attempt
  without duplicate history`).
- [ ] Abort/cancellation emits paired `iteration_started` /
  `boundary_committed` for each completed iteration plus `loop_finished` with
  `loopOutcomeKind: "progress"`; no orphan `iteration_started` (test, mirrors
  `cancellation propagates via AbortSignal`).
- [ ] Re-invoking a run whose terminal boundary is already committed returns the
  prior outcome without appending any log events (test).
- [ ] A throwing log sink causes `executeWriteLoop` to reject; no silent drop
  (test).
- [ ] Omitting the log sink leaves loop behavior unchanged — `write-loop.test.ts`
  stays green without a sink (behavior unchanged by optional logging).
- [ ] No `v2 -> v1` imports; `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v2/docs/v2-architecture.md`:
  - **Interface:** replace "Logs need improvement, but later" with the settled
    event kinds (`iteration_started`, `boundary_committed`, `loop_finished`),
    run-ID query key, append sink + tail/follow reader contract, and note that
    the write loop emits directly. Cross-link inline contracts on the log-stream
    exports.
  - **Persistence:** observability log stream stays out of the orchestration
    store (`v2.sqlite`); separate injectable artifact.
  - **Recovery:** the observability stream is not a recovery source; resume still
    derives from the state store.
  - **Interface (follow):** `follow` replays from the beginning; no offset/cursor
    API — consumers filter post-hoc via `seq`.
- `v2/docs/v1-behaviors.md`: no change — additive v2-only code.
