# Ordered daemon-owned progression and settlement

## Problem

- Even with one stage resolvable (00) and dispatchable (01), nothing admits a pipeline with its context, walks
  its stages in order gated on terminal success, derives pipeline-level settlement from the stage rows, or keeps
  doing any of that once the admitting client disconnects.

## Decisions

- Admission: a new daemon RPC handler, `pipeline_start` (`handlePipelineStart` in `v2/src/daemon/daemon.ts`,
  registered in the same handler map as `start`/`list`), takes an already-validated `PipelineDefinition` plus a
  `PipelineContext` (subspec 00), calls `store.createPipeline`, starts the ordered loop below, and returns
  `{ pipelineId }` once the pipeline and stage rows are durably created — mirroring `startWorkflowRun`'s
  "resolve at row creation, keep running after" shape. The loop is started before the handler resolves and does
  not hold the client connection open; the client disconnecting after receiving `pipelineId` is what proves
  daemon (not client) ownership.
- `v2/src/daemon/pipeline-execution.ts` owns the ordered loop: for each stage in
  `loadPipeline(pipelineId).stages` (authored position order), a workflow stage resolves (00) and dispatches (01)
  only after the immediately preceding workflow stage's row reads `succeeded`. An approval stage stops the loop
  with no dispatch and no settlement — pinned in the intent as deferred to the approval slice.
- One loop instance runs per pipeline, started once from `handlePipelineStart`; before acting on a stage the loop
  re-reads its row's status (not just its own local position), so a stage already `running` is never
  re-dispatched.
- A stage that settles `failed` (per subspec 01, including a start-time dispatch refusal) settles the pipeline at
  `failed`, writes `status: "skipped"` to every later stage via `updateStage`, and dispatches none of them — no
  best-effort continuation.
- Pipeline state is derived from stage rows, no new column, with five states: `succeeded` (every workflow stage
  row `succeeded`), `failed` (any stage row `failed`), `awaiting-approval` (every prior row `succeeded` and the
  next-in-order row is an undispatched approval stage), `running` (some workflow stage row `running`), `pending`
  (admitted, loop has not yet reached any dispatchable stage). `skipped` rows are never dispatched and never
  themselves read as `failed` — they exist only to distinguish "will never run" from "not yet reached."
- Ownership-key contention: a pipeline whose stage targets a `(project, branch)` already claimed by another
  in-flight workflow or pipeline is refused at dispatch time through the daemon's existing single-claim ownership
  registry (the same refusal path as `workflow.start`), recorded as that stage's failure per subspec 01. This
  slice adds no pipeline-level queueing beyond the existing registry; two pipelines targeting the same project
  concurrently is out of scope.
- Observability: pipeline stage runs are not yet attributable to their owning pipeline in `workflow.list`/CLI run
  listings — deferred; `loadPipeline` is the only way to inspect stage-level state in this slice.

## Task checklist

- Add `handlePipelineStart` and register `pipeline_start` in `v2/src/daemon/daemon.ts`.
- Add `v2/src/daemon/pipeline-execution.ts`: the ordered loop, the derived-state helper, skip-on-failure
  write-back.
- Add `v2/src/daemon/pipeline-execution.test.ts`.
- Update `v2/docs/daemon-host.md` and `v2/docs/state-store.md`.

## Acceptance criteria

- [x] A test calls `pipeline_start`, disconnects the client immediately after receiving `pipelineId`, and — via a
      fresh connection or a direct `loadPipeline` read — observes stage two dispatch only after stage one's row
      reads `succeeded`, and the pipeline reach derived state `succeeded`; it fails against the pre-change code
      (no `pipeline_start` handler exists).
- [x] A workflow-only pipeline's stages dispatch in authored-position order; a controlled stage N+1 receives no
      dispatch while stage N's row reads anything other than `succeeded`.
- [x] A stage that settles `failed` settles the pipeline `failed`, writes `skipped` to every later stage, and
      dispatches none of them; inverting the failure-stop guard (continuing past a `failed` stage) turns the
      test RED.
- [x] The derived pipeline state reads `succeeded` only once every workflow stage row reads `succeeded`;
      inverting the all-succeeded guard (reporting `succeeded` with an unsettled stage present) turns the test
      RED.
- [x] A pipeline whose next stage is an approval stage stops there: no dispatch, derived state
      `awaiting-approval`, every later stage still `pending`; inverting the approval-stop guard (dispatching past
      an approval stage) turns the test RED.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/daemon-host.md` documents `pipeline_start`, daemon ownership after client disconnect, ordered
      progression, one-loop-per-pipeline idempotency, failure settlement with `skipped` stages, the
      approval-stage stop, refusal-as-failure, and the ownership-contention and observability deferrals;
      `v2/docs/state-store.md` documents the five derived pipeline states computed from stage rows.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_start` admission, ordered daemon-owned loop, failure settlement with
  `skipped` stages, approval stop, idempotency, deferrals.
- `v2/docs/state-store.md` — derived pipeline state predicate (five states, computed from stage rows).
- `v2/docs/v1-behaviors.md` — no change; additive v2-only behavior.
