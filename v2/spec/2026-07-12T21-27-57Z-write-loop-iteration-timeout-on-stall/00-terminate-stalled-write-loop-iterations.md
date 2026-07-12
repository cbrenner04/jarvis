# Terminate stalled write-loop iterations

## Problem

`executeWriteLoop` records `iteration_started` before awaiting `executeWrite`.
If that await never settles, including before any agent subprocess is spawned,
the durable run and daemon liveness stay active without a terminal log record.

## Decisions

- Arm `iterationTimeoutMs` immediately after `iteration_started` for every attempt — rules out starting the budget only after an agent subprocess exists.
- Add `iteration_timeout` as the terminal write-loop outcome and emit it through `loop_finished` — rules out repurposing `invocation_failure` or leaving a stalled run without a named structured-log terminal record.
- Timeout closes the in-progress attempt and persists the run as failed before the loop resolves — rules out a terminal result whose durable run still appears active.
- Timeout completion must let daemon cleanup remove the active-run and ownership entries — rules out relying on a later kill or process restart to clear in-memory liveness.
- Thread the resolved `iterationTimeoutMs` budget through v2 write-loop launches, defaulting to the existing 600,000 ms policy when no override is supplied — rules out a v2-only hardcoded or unconfigurable timeout.
- Exercise the watchdog with injected short budgets and a non-settling pre-spawn seam — rules out a 10-minute test wait or coverage limited to spawned agents.

## Tasks

- [ ] Add the write-loop iteration watchdog and terminal timeout handling.
- [ ] Carry the configured budget through direct and workflow write-loop launches.
- [ ] Cover stalled pre-spawn execution, durable terminal state, structured logs, and daemon liveness cleanup.
- [ ] Update the required durable docs.

## Acceptance criteria

- [ ] A write-loop attempt that emits `iteration_started` and then stalls past an injected short `iterationTimeoutMs` terminates with `iteration_timeout`; its structured log ends with the named `loop_finished` outcome and its durable run is failed with no open attempt.
- [ ] The timeout also terminates a stalled path that never invokes an agent subprocess; the loop does not depend on subprocess liveness to enforce its wall-clock budget.
- [ ] A timed-out daemon write loop is no longer reported as active and releases its worktree claim after the terminal result.
- [ ] `iterationTimeoutMs` remains configurable for v2 write-loop launches and defaults to 600,000 ms when no value is supplied.
- [ ] `bun test v2/src/execution/write-loop.test.ts v2/src/daemon/daemon-start-list.test.ts` passes with short injected timeout coverage.

## Documentation updates

- `v2/docs/workflow-runner.md` — write-step iteration timeout begins at `iteration_started`, including pre-spawn stalls, and ends with `iteration_timeout`.
- `v2/docs/v1-behaviors.md` — v2 additive write-loop `iterationTimeoutMs` enforcement, terminal logging, and failed-state behavior on stalls.
