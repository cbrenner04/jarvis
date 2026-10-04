# Wait for a pipeline boundary

## Problem

- Callers cannot synchronize with a daemon-owned pipeline without polling snapshots themselves.

## Decisions

- Add `pipeline_wait { pipelineId }`; rules out overloading the non-blocking snapshot request.
- Return `{ kind: "terminal", state }` for `succeeded`, `failed`, `rejected`, or `interrupted`, and `{ kind: "awaiting-approval", stageId }` when the first unsatisfied authored stage is an undecided approval after all predecessors are satisfied; rules out an unnamed intermediate return.
- Keep waiting through `pending` and `running`, including workflow-stage transitions before an approval; rules out treating temporary quiescence as a boundary.
- Read durable state before blocking and return immediately when the requested pipeline is already at a boundary; rules out requiring a new transition after subscription.
- Observe transitions by re-reading durable pipeline/stage rows after in-process stage commits and on bounded polling until `AbortSignal`, using the same derivation as `pipeline_list`; rules out run-log follow and implicit snapshot follow loops.
- Honor the request `AbortSignal` like run `wait`; an aborted wait ends without a boundary result.
- Refuse a missing ID as `invalid_params` and an absent durable pipeline as `unknown_pipeline`; rules out an empty response indistinguishable from transport failure.

## Task checklist

- Register the `pipeline_wait` daemon handler using the shared snapshot derivation.
- Make live waits settle only at a terminal or awaiting-approval boundary.
- Add focused immediate, live, approval-stage-ID, terminal-state, validation, unknown-ID, and abort coverage in `v2/src/daemon/daemon-pipeline-observation.test.ts`.
- Document the wait request, response, refusal, and blocking boundaries.

## Acceptance criteria

- [x] The `pipeline_wait` regression in `v2/src/daemon/daemon-pipeline-observation.test.ts` fails against the baseline and then returns `{ kind: "terminal", state }` for each terminal state and `{ kind: "awaiting-approval", stageId }` for the first undecided approval after satisfied predecessors.
- [x] A live wait remains pending through `pending` and `running`, then resolves at the first durable terminal or awaiting-approval boundary; an already-boundary pipeline returns promptly.
- [x] Missing pipeline IDs return `invalid_params`, and unknown durable IDs return the named `unknown_pipeline` refusal without beginning a wait.
- [x] Aborting a live `pipeline_wait` ends without a boundary result.
- [x] Inverting any added boundary, identifier-validation, unknown-ID, observation-substrate, abort, or continue-wait guard makes `v2/src/daemon/daemon-pipeline-observation.test.ts` fail; negative cases prove pending/running work does not resolve and an awaiting response names the correct authored stage.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/daemon-host.md` documents `pipeline_wait`, its immediate and blocking behavior, durable-row observation substrate, `AbortSignal` cancellation, exact boundary results, and named errors.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline wait request, exact boundary responses, blocking behavior, durable-row observation substrate, `AbortSignal` cancellation, and errors.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only daemon wait.
