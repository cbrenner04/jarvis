# Wait for a pipeline boundary

## Problem

- Callers cannot synchronize with a daemon-owned pipeline without polling snapshots themselves.

## Decisions

- Add `pipeline_wait { pipelineId }`; rules out overloading the non-blocking snapshot request.
- Return `{ kind: "terminal", state }` for `succeeded`, `failed`, `rejected`, or `interrupted`, and `{ kind: "awaiting-approval", stageId }` when the first unsatisfied authored stage is an undecided approval after all predecessors are satisfied; rules out an unnamed intermediate return.
- Keep waiting through `pending` and `running`, including workflow-stage transitions before an approval; rules out treating temporary quiescence as a boundary.
- Read durable state before blocking and return immediately when the requested pipeline is already at a boundary; rules out requiring a new transition after subscription.
- Refuse a missing ID as `invalid_params` and an absent durable pipeline as `unknown_pipeline`; rules out an empty response indistinguishable from transport failure.

## Task checklist

- Register the `pipeline_wait` daemon handler using the shared snapshot derivation.
- Make live waits settle only at a terminal or awaiting-approval boundary.
- Add focused immediate, live, approval-stage-ID, terminal-state, validation, and unknown-ID coverage in `v2/src/daemon/daemon-pipeline-observation.test.ts`.
- Document the wait request, response, refusal, and blocking boundaries.

## Acceptance criteria

- [ ] The `pipeline_wait` regression in `v2/src/daemon/daemon-pipeline-observation.test.ts` fails against the baseline and then returns `{ kind: "terminal", state }` for each terminal state and `{ kind: "awaiting-approval", stageId }` for the first undecided approval after satisfied predecessors.
- [ ] A live wait remains pending through `pending` and `running`, then resolves at the first durable terminal or awaiting-approval boundary; an already-boundary pipeline returns promptly.
- [ ] Missing pipeline IDs return `invalid_params`, and unknown durable IDs return the named `unknown_pipeline` refusal without beginning a wait.
- [ ] Inverting any added boundary, identifier-validation, unknown-ID, or continue-wait guard makes `v2/src/daemon/daemon-pipeline-observation.test.ts` fail; negative cases prove pending/running work does not resolve and an awaiting response names the correct authored stage.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/daemon-host.md` documents `pipeline_wait`, its immediate and blocking behavior, exact boundary results, and named errors.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline wait request, exact boundary responses, blocking behavior, and errors.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only daemon wait.
