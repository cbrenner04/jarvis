# Expose pipeline snapshots

## Problem

- Daemon callers cannot enumerate current pipeline progress without reading the state store directly.

## Decisions

- Add parameterless `pipeline_list` returning `{ pipelines: [{ pipelineId, name, state, stages: [{ stageId, status, workflowInvocationId }] }] }`; rules out reconstructing pipelines from run rows.
- Preserve authored stage order and leave pipeline order unspecified; rules out sorting stages by insertion or workflow-run order and adding an unneeded pipeline-order contract.
- Derive `interrupted` from durable pipeline or stage interruption, `rejected` from a rejected approval, `failed` from a failed stage, `running` from a running stage, `awaiting-approval` from the first undecided approval after satisfied predecessors, `pending` from remaining live undispatched work, and `succeeded` only after every workflow succeeds and every approval is satisfied; rules out treating recovery, rejection, or an undecided gate as live or successful.
- `pending`, `running`, and `awaiting-approval` are non-terminal; `succeeded`, `failed`, `rejected`, and `interrupted` are terminal; rules out callers inferring terminality from raw stage vocabulary.
- `pipeline_list` projects one durable enumeration and returns without following live transitions; rules out turning observation into an implicit wait.
- The response promises no stronger cross-pipeline or concurrent-row isolation than one durable enumeration; rules out holding execution writes for an observer snapshot.

## Task checklist

- Add the typed pipeline snapshot projection and expanded durable-state derivation.
- Register the `pipeline_list` daemon handler.
- Add focused projection, state, ordering, live non-follow, and empty-store coverage in `v2/src/daemon/daemon-pipeline-observation.test.ts`.
- Update the durable daemon observation and derived-state docs.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-pipeline-observation.test.ts` fails against the baseline and then `pipeline_list` reports every admitted pipeline with pipeline ID, name, derived state, and each stage's ID, raw status, and nullable workflow invocation ID in authored order; an empty store returns an empty `pipelines` array.
- [ ] The same regression distinguishes `pending`, `running`, `awaiting-approval`, `succeeded`, `failed`, `rejected`, and `interrupted`, and classifies only the last four as terminal.
- [ ] The live-snapshot regression in `v2/src/daemon/daemon-pipeline-observation.test.ts` completes within its bound while a pipeline remains non-terminal and reports the durable state observed by that request.
- [ ] Inverting any added or modified state-classification, terminality, stage-order/projection, or snapshot non-follow guard makes `v2/src/daemon/daemon-pipeline-observation.test.ts` fail; negative cases prove undecided approval and live work are not reported terminal and no stage is omitted or reordered.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/daemon-host.md` owns the `pipeline_list` wire contract, state derivation, terminality, ordering, isolation, and non-follow semantics; `v2/docs/state-store.md` links to that daemon-owned derivation instead of duplicating it.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline snapshot request, response, derived states, terminality, ordering, isolation, and non-follow behavior.
- `v2/docs/state-store.md` — replace the duplicated five-state derivation with a link to its daemon-owned durable home.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only daemon observation.
