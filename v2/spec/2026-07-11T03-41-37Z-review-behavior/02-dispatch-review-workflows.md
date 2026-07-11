# Dispatch review workflows

Dispatch programmatic `review` steps through the workflow runner.

## Decisions

- A `review` step declares separate critic and actuator agent orders; rules out one shared fallback order because role availability and preference may differ.
- Resolve critic and actuator bindings when the step is reached; rules out precomputing or reusing another step's chain.
- Map a fully completed or empty-verdict review to `complete`, and any role failure to `invocation_failure`; rules out adding review-only workflow outcomes.
- Review steps have no durable run or mid-cycle resume and return `resumable: false`; rules out state-store or loader expansion before a caller requires it.
- Give each reached review step a fresh synthesized run ID and call `onStepRunCreated` before execution; rules out omitting lifecycle reporting because no durable run row exists.
- Include review metadata in the shared durable workflow snapshot but exclude review from durable run lookup; rules out hiding it from daemon/TUI rows or treating its synthesized run ID as resumable identity.
- Reuse a snapshot found through a durable write/human step only when the ordered review entries' `(stepId, behavior)` match; rules out matching workflows while ignoring review identity. A review-only invocation creates a fresh snapshot and restarts at cycle zero.
- Support object-literal programmatic steps only; rules out workflow-loader, preset, and YAML/config authoring changes in this slice.
- Reuse the existing actuator resolution contract; rules out a review-specific writer role or altered actuator rung semantics.

## Tasks

- Add `behavior: "review"` to the workflow step union with critic prompt, per-role agent orders, shared model config, verdict path, and cycle bound; no actuator prompt field.
- Validate critic and actuator `(agent, role)` entries before durable workflow changes.
- Resolve each role independently, dispatch to the review executor, and map role, abort, and verdict-I/O failures into `WorkflowResult`.
- Integrate synthesized run reporting and review entries with workflow snapshot creation, matching, reuse, daemon/TUI projection, and durable-run lookup boundaries.
- Add co-located workflow-runner and snapshot-projection tests for dispatch, resolution, validation, outcomes, accounting, identity, reporting, and restart behavior.
- Update the programmatic dispatch contract in `v2/docs/workflow-runner.md`; cross-link the cycle contract in `v2/docs/write-behavior.md`.

## Acceptance criteria

- [x] A programmatic `behavior: "review"` step resolves critic and actuator from their own agent orders and `(agent, role)` rungs when reached, then runs the review executor.
- [x] Quota exhaustion can fall through later configured agents independently for critic and actuator.
- [x] Missing critic or actuator bindings are aggregated as `(stepId, role, agent)` validation errors before any durable workflow state change.
- [x] Empty-verdict termination and all successfully bounded cycles map to `WorkflowResult.kind === "complete"`; critic, actuator, abort, or verdict-file failure maps to `"invocation_failure"` and prevents later workflow steps.
- [x] `WorkflowResult.iterationsConsumed` includes every cycle whose critic started, including role-failed cycles, and excludes invalid-input or pre-critic verdict invalidation failures.
- [x] Each reached review step gets a fresh synthesized run ID, calls `onStepRunCreated(stepIndex, runId)` once before role execution, and returns that ID without creating a durable run row.
- [x] Shared workflow snapshots include review steps in authored order and daemon/TUI projection; matching compares each review entry's `(stepId, behavior)`, while existing-run lookup considers only durable write/human steps.
- [x] Review results return `resumable: false`; a repeated review-only invocation gets a fresh snapshot/run ID and starts at cycle zero, while a mixed workflow may reuse a matching durable snapshot without resuming review cycle state.
- [x] Existing `v2/src/execution/workflow-loader.test.ts` loader-scope tests stay green; loader and presets do not accept `review` steps.
- [ ] Co-located tests cover role-specific resolution, distinct orders, quota fallthrough, outcome/accounting mapping, run callback timing, snapshot inclusion/matching/reuse, durable-lookup exclusion, later-step suppression, and restart-from-zero.
- [x] `v2/docs/workflow-runner.md` documents programmatic `review` shape, validation, dispatch, outcomes, identity, snapshot reporting/reuse, and non-resume boundaries, and cross-links `v2/docs/write-behavior.md` for cycle semantics.

## Documentation updates

- `v2/docs/workflow-runner.md` — add programmatic review authoring, validation, dispatch, outcomes, and non-resume boundaries.
- `v2/docs/write-behavior.md` — cross-link workflow dispatch from the canonical cycle section if needed.
