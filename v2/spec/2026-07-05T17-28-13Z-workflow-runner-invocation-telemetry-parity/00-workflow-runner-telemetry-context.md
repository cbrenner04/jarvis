# 00 - executeWorkflow constructs shared telemetry context for write and review-debate steps

`shared/invocation/execute.ts` emits `invocation_completed` rows when passed a
telemetry context and sink. `v2/src/execution/write.ts` and
`v2/src/execution/review-debate.ts` already thread an optional `telemetry`
field to that seam. `executeWorkflow` (`v2/src/execution/workflow-runner.ts`)
never constructs or passes that context today, so no step dispatched through
the workflow runner emits telemetry, for either behavior.

## Decisions

- `WorkflowRunnerInput` gains optional `telemetry: { operatorSessionId: string; workflow: string; sinkPath?: string }`; omitted → no `invocation_completed` rows for either behavior (preserves current no-op default) — rules out an always-on default that would change behavior for existing callers/tests with no opt-in.
- Default `sinkPath` is `~/.jarvis/telemetry.jsonl`, overridable via `telemetry.sinkPath` — mirrors `openStateStore(storePath?)`'s default-path pattern — rules out a hardcoded, non-injectable path.
- `ReviewDebateWorkflowStep` gains required `project: string` and `branch: string` fields, mirroring `HumanWorkflowStep`'s explicit identity (review-debate has no `worktree` object to derive these from); telemetry's `worktree_path` uses the step's existing `cwd` — rules out inventing a worktree wrapper for a behavior that has none.
- A review-debate step's `run_id` and `attempt_id` are synthesized once per `executeWorkflow`-dispatched step invocation and held constant across every cycle and role in that call (no durable review-debate run/attempt exists yet, per `runReviewDebateStep`'s existing comment) — rules out per-role or per-cycle IDs, which would fragment one step's rows under unjoinable identities.
- Wiring `v2/src/cli.ts` / `v2/src/daemon/daemon.ts` to call `executeWorkflow` is out of scope. Deferred to first consumer: `executeWorkflow` has no production caller today (both entrypoints call `executeWriteLoop` directly) — pin when a caller needs it.

## Task checklist

- [ ] Add `telemetry` option to `WorkflowRunnerInput`; default-resolve `sinkPath`.
- [ ] In the `write`-step dispatch path, populate `WriteLoopInput.telemetry` (`sinkPath`, `operatorSessionId`, `workflow`, `role: step.role`) from the workflow-runner-level context.
- [ ] Add `project` / `branch` fields to `ReviewDebateWorkflowStep`.
- [ ] In `runReviewDebateStep`, synthesize `runId`/`attemptId` once per call (replacing the end-of-call throwaway `crypto.randomUUID()`) and build the `ReviewDebateInput.telemetry` context (sink from `sinkPath`, `operatorSessionId`, `runId`, `attemptId`, `project`, `workflow`, `stepId`, `worktreePath: cwd`, `branch`, `specRef`) from the same workflow-runner-level context.
- [ ] Extend `workflow-runner.test.ts` covering both step behaviors under the same `executeWorkflow` call.

## Acceptance criteria

- [ ] `executeWorkflow({ steps, telemetry: { operatorSessionId, workflow, sinkPath } })` emits one `invocation_completed` row per binding attempt for a `write` step, appended to the resolved sink, with `operator_session_id`, `workflow`, `step_id`, `role` set from the workflow-runner-constructed context.
- [ ] The same `executeWorkflow` call emits `invocation_completed` rows for a `review-debate` step's role invocations, appended to the same sink, with `operator_session_id` and `workflow` matching the write step's values and a `role` per debate role.
- [ ] `invocation_completed` rows emitted for a `write` step and a `review-debate` step in the same `executeWorkflow` call share identical field names and types — `schema_version`, `record_kind`, and every required context field in `v2/docs/telemetry-capture.md`'s `invocation_completed` section — no per-behavior fork in shape.
- [ ] A `review-debate` step's rows share one `run_id` and one `attempt_id` across every cycle and role in that step invocation.
- [ ] Omitting `telemetry` from `executeWorkflow`'s input emits no `invocation_completed` rows for either step behavior.

## Documentation updates

- `v2/docs/telemetry-capture.md`: note that `executeWorkflow` (`workflow-runner.ts`) now constructs one shared per-step telemetry context and passes it identically to `write` and `review-debate` steps, still awaiting a production caller (`cli.ts`/`daemon.ts` call `executeWriteLoop` directly today).
