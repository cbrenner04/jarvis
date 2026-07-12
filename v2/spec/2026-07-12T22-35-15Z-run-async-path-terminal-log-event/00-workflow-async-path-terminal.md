# 00 - Workflow async-path failure settles terminally

## Problem

`startWorkflowRun` (`v2/src/daemon/daemon.ts`) hands `executeWorkflow` rejections to
`.catch((err) => resolve({ kind: "error", ... }))`. That resolve is a no-op once step 0's
run row has already resolved the start promise. So a workflow that throws after
`iteration_started` — anywhere past step 0's run creation — vanishes: no terminal
structured-log record, durable row left non-terminal (`list` keeps reporting it), and the
`finally` block silently drops liveness and closes the log sink. Daemon stdio is discarded
(`daemon-lifecycle.ts` spawns with `stdio: "ignore"` when no log fd), so nothing surfaces.

The write-loop path is already covered: `spawnWriteLoop`'s catch demotes durable status and
awaits `failureReporter`, which appends `run_execution_failed`. This subspec brings the
workflow async path to the same terminal contract.

## Decisions

- Settle in `startWorkflowRun`'s rejection path, before the `finally` releases liveness and closes the log sink — rules out appending after `logSink.close()` (dropped record) and rules out leaving `list` reporting the run.
- Settle every run id tracked in `workflowRunIds` that is not already in a terminal durable status — rules out settling only step 0, which would strand a later step's row `in-progress`.
- Append `run_execution_failed` carrying the rejection's `message`, reusing the existing kind — rules out a parallel failure event schema, and rules out a kind-only record that names no cause (`write-loop.ts` already emits `message` on its throw path).
- Durable demotion to `failed` and the log append are each best-effort (`try`/`catch`), and neither blocks the other or the `finally` cleanup — rules out a persistence fault leaving the registry claimed.
- Keep the pre-step-0 behavior: a rejection before any run row exists still resolves the RPC with `invalid_params` — rules out changing `start`'s error contract for invalid step shapes.
- No process-level `unhandledRejection`/`uncaughtException` handler — a detached rejection carries no run attribution, so it cannot append to a run's log; out of scope.

## Task checklist

- [ ] In `startWorkflowRun`, replace the swallow-after-resolve catch with a settle path: for each tracked run id whose durable status is non-terminal, best-effort `setRunStatus(runId, "failed")` and append `{ kind: "run_execution_failed", message }` through the workflow's open log sink; still resolve the RPC error when step 0 never created a row.
- [ ] Tests in `v2/src/daemon/daemon-run-failure-capture.test.ts` (or a sibling workflow-failure test): rejection after step 0's run row → durable `failed`, exactly one `run_execution_failed` with the error message, `isLive: false` on `list`, worktree key released; rejection before any run row → RPC error, unchanged.
- [ ] Confirm an already-terminal run row (e.g. the step settled `failed` itself) is not re-demoted and gets no duplicate terminal record.
- [ ] Docs.

## Acceptance criteria

- [ ] A workflow whose async path throws after `iteration_started` records a `run_execution_failed` event carrying the error's message in that run's structured log, and the run is no longer reported live by `list`.
- [ ] The durable run row for such a failure ends `failed` when it was not already in a terminal status; an already-terminal row is left as-is with no duplicate terminal record.
- [ ] `wait` on a run ended by a workflow async-path failure resolves with `runStatus: "failed"` and a `harness_failure` operator error rather than hanging.
- [ ] The workflow's worktree ownership key is released even when durable demotion or the log append fails.
- [ ] A workflow rejection before step 0's run row exists still resolves `start` with an `invalid_params` error (`daemon-workflow-start.test.ts` stays green).
- [ ] Existing spawn-boundary capture is unchanged (`daemon-run-failure-capture.test.ts` stays green).

## Documentation updates

- `v2/docs/daemon-host.md` — extend the spawn-boundary failure-capture section to cover run async-path failure after `iteration_started` (workflow path): terminal `run_execution_failed` with `message`, durable `failed`, `isLive: false`, ownership released.
- `v2/docs/first-workflow-walkthrough.md` — in the structured-log/observe path, note that a harness failure mid-workflow appears as a terminal `run_execution_failed` record naming the error, not a run stuck `in-progress`.
- `v2/docs/v1-behaviors.md` — new terminal path entry for daemon workflow async-path failure capture.
