# Terminate stalled write-loop iterations

## Problem

`executeWriteLoop` records `iteration_started` before awaiting `executeWrite`.
If that await never settles, including before any agent subprocess is spawned,
the durable run and daemon liveness stay active without a terminal log record.

## Decisions

- Arm `iterationTimeoutMs` immediately after `iteration_started` for every attempt — rules out starting the budget only after an agent subprocess exists.
- Treat timeout as a terminal fence: close the started or resumed attempt as `iteration_timeout`, persist the run `failed`, and emit exactly one `loop_finished: iteration_timeout` before resolving — rules out a late settle, throw, or second terminal record reopening or changing the result.
- Abort observed before the watchdog fires wins; after it fires, `iteration_timeout` wins and late abort, completion, or failure effects are suppressed — rules out timing-dependent terminal outcomes.
- Timeout completion must let daemon cleanup remove the active-run and ownership entries — rules out relying on a later kill or process restart to clear in-memory liveness.
- Resolve the operator configuration field `~/.jarvis/config.json` `iterationTimeoutMs` into direct and workflow write-loop launches, with `600,000` ms when absent — rules out a v2-only hardcoded or unconfigurable budget.
- Persist each workflow write step's resolved budget in its workflow snapshot for resume and revise reconstruction — rules out resumed/revised loops silently reverting to a different budget.
- Add `iteration_timeout` to durable attempt outcomes, write-loop outcomes, terminal logs, workflow results, daemon `list`/`wait` and snapshots, CLI rendering, and operator-error mapping; keep `run_execution_failed` for harness faults outside normal loop settlement — rules out consumers treating timeout as an unknown outcome or a harness failure.
- Exercise the watchdog with injected short budgets across pre-spawn stalls, normal settlement, fresh iterations, and races — rules out a 10-minute test wait or coverage limited to spawned agents.

## Tasks

- [ ] Add the write-loop watchdog, timeout fence, and race precedence.
- [ ] Propagate the resolved config budget through direct, workflow, snapshot, resume, and revise launches.
- [ ] Propagate `iteration_timeout` through durable, workflow, daemon, CLI, and operator-error terminal consumers.
- [ ] Cover stalls, settlement, races, and direct/workflow daemon cleanup with short injected budgets.
- [ ] Update the required durable docs.

## Acceptance criteria

- [x] A write-loop attempt that emits `iteration_started` and then stalls past an injected short `iterationTimeoutMs` resolves despite non-settling execution as `iteration_timeout`; it closes the started or resumed attempt, persists the run `failed`, and appends exactly one terminal `loop_finished` record.
- [x] The timeout also terminates a stalled path that never invokes an agent subprocess; the loop does not depend on subprocess liveness to enforce its wall-clock budget.
- [x] Normal settlement clears its watchdog, each later iteration receives a fresh full budget, and completion or failure arriving after timeout cannot emit another boundary or terminal effect.
- [x] Abort before watchdog fire returns the existing abort outcome; watchdog fire before abort, completion, or failure returns `iteration_timeout`.
- [x] Direct and workflow launches resolve `~/.jarvis/config.json` `iterationTimeoutMs`, default it to 600,000 ms, and preserve the resolved value through persisted workflow snapshot resume and revise reconstruction.
- [x] `iteration_timeout` is accepted and surfaced as a failed terminal outcome by durable attempt/run state, workflow results, daemon `list`/`wait` and workflow snapshots, CLI output, and operator-error mapping; `run_execution_failed` remains the distinct harness-failure terminal.
- [x] Timed-out direct and workflow-started daemon loops are no longer live and release their worktree claims after the terminal result.
- [x] `bun test v2/src/execution/write-loop.test.ts v2/src/execution/workflow-runner.test.ts v2/src/daemon/daemon-start-list.test.ts v2/src/daemon/daemon-wait-run-completion.test.ts v2/src/daemon/daemon-resume.test.ts v2/src/daemon/daemon-revise.test.ts v2/src/daemon/run-operator-error.test.ts v2/src/cli.test.ts` passes with short injected timeout coverage.

## Documentation updates

- `v2/docs/workflow-runner.md` — write-step iteration timeout begins at `iteration_started`, including pre-spawn stalls, uses the resolved config budget, and ends with `iteration_timeout`.
- `v2/docs/daemon-host.md` — `iteration_timeout` vocabulary on daemon `list`, `wait`, workflow snapshots, and operator errors; distinct from `run_execution_failed`.
- `v2/docs/write-behavior.md` — CLI terminal outcome rendering for `iteration_timeout`.
- `v2/docs/v1-behaviors.md` — v2 additive write-loop `iterationTimeoutMs` enforcement, terminal logging, failed-state behavior, and late-result suppression on stalls.
