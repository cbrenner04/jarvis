---
name: workflow-stall-is-observable-and-kill-reaps-it
---

# A stalled workflow step is observable while live, and `run kill` reaps it

## Problem

`jarvis run kill` on a workflow-started run that `list` reports `in-progress`/`live` returns
`run_not_active`: `killHandler` (`v2/src/daemon/daemon.ts:1088-1095`) only reaps `kind:"write-loop"`
entries, and workflow-kind entries carry no abort handle to act on. Reproduced live on 2026-07-25,
where `daemon stop` refused (`active durable runs`) while `run kill` refused the same run
(`run_not_active`) — nothing could clear it.

Four attempts to add a `reapable` discriminant have failed for one structural reason: **every signal
tried so far coincides with the run terminating, so no `(live ∧ reapable)` state is ever observable
by a real kill.** Two codex attempts latched off "the active attempt has no bound agent subprocess",
an inference the daemon cannot make (the workflow-kind `activeRuns` entry is `{kind,runId}`, no
subprocess handle) — un-threaded, never fired. A sharpened spec (#1749) latched on the write-loop
watchdog resolving `timed_out`/`aborted` and on orphan-settle; the faithful implementation (#1760,
closed) is a runtime no-op — `onReapable(runId)` is immediately followed by a terminal
`finishLoop`/`finishIterationTimeout` in the same synchronous continuation, and the orphan `.finally`
latch is a synchronous set-then-delete that never runs at all for a genuinely never-settling orphan.
Verified empirically (8 trials × 200 macrotask kill-polls → zero reaps).

The state that actually needs detecting is a step whose `activeRuns` entry persists while it makes no
forward progress, **without** hitting `iterationTimeoutMs` (which terminates it) and **without** the
workflow settling (which deletes the entry). That requires a live idle/output-age signal, distinct
from the terminal wall-clock timeout. v2 has none today, and the in-flight
`20260725T004726Z-write-path-idle-output-watchdog` implements idle-output as a **terminal**
`idle_output_timeout` outcome — the same termination-coincident shape that already failed four times,
so it does not supply this either. **This intent introduces the live signal**; it is the deliverable,
not a prerequisite.

## Decisions

- The workflow-kind `activeRuns` entry (`v2/src/daemon/daemon.ts:72-84`) tracks output age directly
  and flips a stall flag once the threshold is crossed **while the run remains non-terminal and
  live**. Rules out deriving the flag from iteration-timeout, abort, or workflow-settle — all four
  prior attempts failed precisely because those coincide with termination.
- Surface the stalled-but-live state to the operator on the `run list` row and as a daemon log event,
  so a wedged step is diagnosable without reading process trees.
- A healthy, progressing step never latches; forward progress resets output age.
- `jarvis run kill` accepts a workflow-started run whose entry is latched stalled while live: abort
  the step, record durable `killed` (non-boundary-terminal rows only), retain the worktree, and have
  `list` subsequently report `isLive:false`. Threading an abort handle onto the workflow-kind
  `activeRuns` entry is part of this work.
- A healthy, progressing workflow step keeps rejecting kill with `run_not_active`.
- Land observability first and kill acceptance second — kill is defined in terms of the latch, and
  the latch is the part that has failed four times. Rules out changing kill acceptance against a
  signal that has not been proven observable.

## Acceptance criteria

- [ ] A genuinely live, non-terminal, stalled workflow step latches its stall flag and the flag is
      observable at that moment on the `run list` row; making the latch a no-op turns the test RED
      (the mutation that stayed green in #1760).
- [ ] A healthy, progressing step never latches, and progress resets output age.
- [ ] The stall is recorded as a daemon log event naming the run.
- [ ] A workflow-started run latched stalled while live accepts `jarvis run kill`, reaches durable
      `killed` with the worktree retained, and `list` then reports `isLive:false`.
- [ ] A healthy progressing workflow step still rejects kill with `run_not_active`.
- [ ] Regression coverage drives a genuinely live-but-stalled step — idle threshold crossed, run still
      non-terminal and live — rather than a step at its terminal iteration timeout.

## Documentation updates

- `v2/docs/daemon-host.md` — the live stall signal on workflow-kind entries, and § Live controls on
  workflow-started runs: the kill contract.
- `v2/docs/first-workflow-walkthrough.md` — the wedged-workflow kill contract.
- `v2/docs/operator-runbook.md` — drop the "no jarvis-native way to stop a workflow implement" entry
  and replace it with the kill path.

## Prerequisites

Plan as two subspecs in order: the live stall signal, then kill acceptance defined in terms of it.
