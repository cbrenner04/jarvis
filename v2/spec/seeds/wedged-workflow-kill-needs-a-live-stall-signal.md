# Seed: wedged-workflow kill needs a live-observable stall signal (not a termination-coincident latch)

## Problem

`jarvis run kill` on a workflow-started run that `list` shows as `in-progress`/`live` returns
`run_not_active` — the daemon's `killHandler` only reaps `kind:"write-loop"` entries, not `kind:"workflow"`.
Four attempts to add a "reapable" discriminant have failed, all for the same structural reason: **every
signal tried so far coincides with the run terminating, so no `(live ∧ reapable)` state is ever
observable by a real kill.**

Attempt history:

- Two codex attempts: latched `reapable` off "the active attempt has no bound agent subprocess" — an
  inference the daemon can't make (the workflow-kind `activeRuns` entry is `{kind,runId}`, no subprocess
  handle). Un-threaded, never fired.
- Operator sharpened the spec (#1749) to latch on two events: the write-loop `awaitIteration` watchdog
  resolving `timed_out`/`aborted`, and orphan-settle (`executeWorkflow` promise settled while an entry
  remains). A claude attempt (#1760, closed) implemented it faithfully — and it is a **runtime no-op**:
  - `write-loop.ts:255/260`: `onReapable(runId)` fires and is immediately followed by
    `finishLoop(...,true)` / `finishIterationTimeout(...)` — both terminal. The run goes
    terminal+not-live in the same synchronous continuation; `reapable:true` + live is never observable.
  - Orphan latch (daemon `.finally`): synchronous set-then-delete = no-op; and for a genuinely
    never-settling orphan (the case it targets) `.finally` never runs, so it never latches.
  - Verified empirically (8 trials × 200 macrotask kill-polls → zero reaps) and by code read.

## Root cause

A workflow step that is **live but wedged** (the actual bug state) is a step whose `activeRuns` entry
persists while it makes no forward progress **without hitting `iterationTimeoutMs`** (which would
terminate it) and **without the workflow settling** (which would delete the entry). Detecting that
state requires a **live idle/stall signal** — an output-age / no-progress watchdog that fires *while the
run is still live*, distinct from the wall-clock iteration timeout that terminates it. v2 has no such
signal today (only the terminal `iterationTimeoutMs` wall-clock; the v1 idle-output watchdog has no v2
analogue — see the v2 operator runbook § Choosing an actuator).

## Decisions

- Do not re-attempt the reapable discriminant off any termination-coincident event
  (iteration-timeout, abort, orphan-settle) or off an un-threaded subprocess inference — all four
  failed for this reason.
- The correct discriminant is a **live stall signal**: latch `reapable:true` when a workflow step's run
  is live in `activeRuns` AND has exceeded an idle/output-age threshold without terminating. This
  depends on Wave 4 liveness/escalation work (`invocation-output-age-telemetry`,
  `v2-write-loop-escalates-on-stall`, `review-and-shrink-steps-have-no-timeout`), which introduces the
  live idle signal this needs.
- Sequence: land the Wave 4 idle/output-age signal first, then define `reapable` in terms of it. Until
  then, killing a wedged workflow run has no jarvis-native path — kill the agent process tree directly
  (documented in the v2 runbook).

## Acceptance criteria

- [ ] A workflow-started run that is live in `activeRuns` and has crossed the live idle/stall threshold
      (Wave 4 signal) — NOT merely at its terminal iteration-timeout — latches `reapable:true` while
      still live, accepts `jarvis run kill`, reaches durable `killed` with the worktree retained, and
      `list` then reports `isLive:false`.
- [ ] A regression test drives a genuinely live-but-stalled workflow step (idle threshold crossed,
      run still non-terminal and live) and asserts kill succeeds — i.e. making the latch a no-op turns
      this test RED (the mutation that stayed green in #1760).
- [ ] A healthy progressing workflow step stays `reapable:false` and rejects kill `run_not_active`.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` / `first-workflow-walkthrough.md` — wedged-workflow kill contract, once the
  live-stall discriminant lands.

## Prerequisites

- Wave 4 live idle/output-age stall signal for workflow steps (`invocation-output-age-telemetry` and
  `v2-write-loop-escalates-on-stall`).
