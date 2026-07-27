# Dispatch and record one workflow stage

## Problem

- An admitted `pipeline_stages` row is inert: nothing turns a workflow stage's `(workflow, review)` pair into a real workflow invocation, and nothing writes back what that invocation produced.

## Decisions

- A dedicated daemon-side stage dispatcher (`v2/src/daemon/pipeline-stage-dispatch.ts`) owns stage → invocation translation; rules out inlining the mapping into `handleWorkflowStart`, which serves CLI-shaped starts and would conflate stage lifecycle with claim admission.
- The stage's `review` posture selects the preset/builder: `intent`+`none` → `intent`, `intent`+`light` → `intent-reviewed`, `plan`+`none` → `plan`, `plan`+`light` → `plan-reviewed-light`, `plan`+`debate` → `plan-reviewed`, `implement`+`light|debate` → the implement builder with `reviewBehavior` set to the posture; rules out falling back to the project's configured implement review behavior, which would silently substitute a project default for the pipeline's authored posture. Validation already rejects `intent`+`debate` and `implement`+`none`, so the dispatcher rejects any unmapped pair as an error rather than defaulting.
- Dispatch goes through the daemon's own workflow-start path (one real `executeWorkflow` invocation); rules out synthesizing steps and a fake invocation ID for stage bookkeeping.
- The dispatcher records `startedAt` and the entry run's `workflowSnapshot.invocationId` before the invocation settles, so a crash mid-stage leaves a resolvable linkage; rules out recording linkage only at settlement.
- On settlement the dispatcher records `endedAt`, the terminal stage status, and either an artifact reference or `failureDetail`. Stage status vocabulary: `pending` (admitted), `running` (dispatched, unsettled), `succeeded`, `failed`.
- The artifact reference is an orchestration pointer read off the durable entry run row — entry run ID, invocation ID, spec path, and PR number/URL when present; rules out copying artifact file content into SQLite.
- A builder error (unmapped pair, invalid build input) is recorded as a stage failure with detail, not thrown to the caller; rules out leaving the stage `pending` with the fault visible only in daemon stderr.

## Task checklist

- Add `v2/src/daemon/pipeline-stage-dispatch.ts`: posture → preset resolution, dispatch, and stage lifecycle write-back via `StateStore.updateStage`.
- Add `v2/src/daemon/pipeline-stage-dispatch.test.ts` with fake step-binding fixtures.
- Update `v2/docs/daemon-host.md` and `v2/docs/state-store.md`.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-stage-dispatch.test.ts` dispatches one workflow stage and asserts the recorded `workflowInvocationId` resolves to the workflow run row created by that dispatch; it fails against the pre-change code.
- [ ] A dispatched stage records `startedAt` and its invocation linkage before the invocation settles, and `endedAt` plus a terminal status after it settles.
- [ ] Each `(workflow, review)` pair maps to its named preset/builder, and the implement stage's built steps carry the stage's posture as review behavior rather than the project's configured value.
- [ ] A stage that cannot be built (unmapped pair or invalid build input) records `failed` with failure detail and dispatches no workflow.
- [ ] A successful stage records an artifact reference containing the entry run ID, invocation ID, and spec path, and no artifact file content.
- [ ] Inverting each added guard (posture→preset selection, the pre-settlement linkage write, the build-failure branch) turns the corresponding test RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/daemon-host.md` documents stage dispatch, posture→preset mapping, invocation linkage, and artifact recording; `v2/docs/state-store.md` documents the stage status vocabulary and the pointer-only artifact envelope.

## Documentation updates

- `v2/docs/daemon-host.md` — stage dispatch, posture→preset mapping, invocation linkage, artifact/failure recording.
- `v2/docs/state-store.md` — stage status vocabulary and pointer-only artifact envelope.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only behavior.
