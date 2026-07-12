# 00 - Workflow async-path failure settles terminally

## Problem

`startWorkflowRun` (`v2/src/daemon/daemon.ts`) hands `executeWorkflow` rejections to
`.catch((err) => resolve({ kind: "error", ... }))`. That resolve is a no-op once step 0's
run row has already resolved the start promise. So a workflow that throws after
`iteration_started` — anywhere past step 0's run creation — vanishes: no terminal
structured-log record, durable row left non-terminal (`list` keeps reporting it), and the
`finally` block silently drops liveness and closes the log sink. Daemon stdio is discarded
(`daemon-lifecycle.ts` spawns with `stdio: "ignore"` when no log fd), so nothing surfaces.

## Decisions

- The write-loop path needs no change: `spawnWriteLoop`'s catch (`daemon.ts`) already demotes non-terminal durable status to `failed` and awaits `failureReporter`, and the queued-promotion and resume paths re-enter through that same catch — the workflow path is the only uncovered one, so this is one subspec, not two.
- Append the workflow record **directly through the workflow's open `logSink`** (`logSink.append(runId, { kind: "run_execution_failed", message })`), not via `failureReporter` — `createRunExecutionFailureReporter` discards its `reason` and emits a message-less record, which would silently fail the message-carrying criterion.
- `createRunExecutionFailureReporter` stays message-less and unchanged — rules out widening the spawn-boundary contract in this slice.
- Terminal means `isTerminalRunStatus` (`daemon.ts`), the same predicate `spawnWriteLoop` uses. It counts `paused` terminal: a workflow rejecting while its run is `paused` leaves the row `paused` and appends no terminal record — resumability outranks failure reporting. Non-terminal statuses (`queued`, `in-progress`, `revising`) are demoted and get the record.
- Fixed ordering per run id: durable demote → log append → `finally` (release liveness, close sink). `wait` wakes on the terminal log record and then reads durable status, so appending before the status commit would let a waiter observe a pre-demotion status — rules out "each is best-effort, either order".
- Each side is independently `try`/`catch`-wrapped: a demote fault does not skip the append, an append fault does not roll back the demote, and neither aborts the `finally` cleanup.
- Kill/abort rejections must not read as harness failure. The terminal guard is the protection: the kill path commits `killed` durably before the abort-driven rejection surfaces, so the guard suppresses both demote and append. This ordering is load-bearing — pin it with a test rather than assume it.
- Settle every run id in `workflowRunIds` that is non-terminal — rules out settling only step 0, which would strand a later step's row `in-progress`.
- No log sink (logs not configured, `logSink === undefined`): durable demotion still runs; the append is skipped.
- `message` uses the existing coercion `err instanceof Error ? err.message : String(err)`. No length cap.
- Keep pre-step-0 behavior: a rejection before any run row exists still resolves the RPC with `invalid_params` — rules out changing `start`'s error contract for invalid step shapes.
- No process-level `unhandledRejection`/`uncaughtException` handler — a detached rejection carries no run attribution, so it cannot append to a run's log; out of scope.

## Task checklist

- [ ] In `startWorkflowRun`, replace the swallow-after-resolve catch with a settle path over `workflowRunIds` in the order above; still resolve the RPC error when step 0 never created a row.
- [ ] Tests in `v2/src/daemon/daemon-run-failure-capture.test.ts` (or a sibling workflow-failure test): rejection after step 0's run row → durable `failed`, exactly one `run_execution_failed` carrying the error message, `isLive: false` on `list`, worktree key released; rejection before any run row → RPC error, unchanged.
- [ ] Test: a run already terminal at rejection time (`failed`, and separately `paused`) is not re-demoted and gets no terminal record.
- [ ] Test: a killed workflow whose executor rejects from the abort produces no `run_execution_failed` record.
- [ ] Fault-injection test: a throwing `setRunStatus`, and separately a throwing `logSink.append`, each still leave the worktree key released and the sink closed, and do not suppress the other side.
- [ ] Test: no configured log sink → durable demotion still lands, no append attempted.
- [ ] Docs.

## Acceptance criteria

- [ ] A workflow whose async path throws after `iteration_started` records a `run_execution_failed` event carrying the error's message in that run's structured log, and the run is no longer reported live by `list`.
- [ ] The durable run row ends `failed` when `isTerminalRunStatus` was false; an already-terminal row (including `paused`) is left as-is with no terminal record.
- [ ] The status commit is observable before the terminal record: `wait` on a run ended by a workflow async-path failure resolves with `runStatus: "failed"` and a `harness_failure` operator error rather than hanging or reporting a pre-demotion status.
- [ ] A killed workflow produces no `run_execution_failed` record.
- [ ] With no log sink configured, the durable row still ends `failed`.
- [ ] The workflow's worktree ownership key is released even when durable demotion or the log append throws.
- [ ] A workflow rejection before step 0's run row exists still resolves `start` with an `invalid_params` error (`daemon-workflow-start.test.ts` stays green).
- [ ] Existing spawn-boundary capture is unchanged (`daemon-run-failure-capture.test.ts` stays green).

## Documentation updates

- `v2/docs/daemon-host.md` — extend the spawn-boundary failure-capture section to cover workflow async-path failure after `iteration_started`: terminal `run_execution_failed` with `message`, durable `failed`, demote-before-append ordering, `paused`/`killed` suppression, `isLive: false`, ownership released.
- `v2/docs/first-workflow-walkthrough.md` — in the structured-log/observe path, note that a harness failure mid-workflow appears as a terminal `run_execution_failed` record naming the error, not a run stuck `in-progress`.
- `v2/docs/v1-behaviors.md` — new terminal path entry for daemon workflow async-path failure capture.
