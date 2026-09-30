# Standalone-only preset registry and pipeline refusal

Pipeline stage `workflow` values today are only `intent`, `plan`, and `implement` (`BASE_WORKFLOW_NAMES`). Standalone-only CLI presets (first consumer: review-feedback re-entry) must be registrable without implying pipeline composability. `validatePipelineDefinition` must reject a stage whose `workflow` names a registered standalone-only preset with an error distinct from `unknown-workflow`, while base workflows keep today’s posture and role-binding rules.

## Decisions

- Colocate per-preset `pipelineStageEligible` metadata with `WORKFLOW_PRESET_BUILDERS` in `v2/src/execution/workflow-presets.ts` (rules out a second name list that can drift from builders).
- Default `pipelineStageEligible: true` for every preset already in `WORKFLOW_PRESET_BUILDERS` (rules out opt-in pipeline eligibility for shipped presets).
- Reserve `review-feedback` in that metadata with `pipelineStageEligible: false` before its builder lands (rules out waiting for the review-feedback slice to introduce the first standalone-only name the validator must recognize).
- Deferred to first consumer: whether `review-feedback` also joins `WORKFLOW_PRESET_BUILDERS` in this slice or only the metadata table until the review-feedback ready-intent — pin when that slice opens.
- Pipeline stage `workflow` continues to mean base workflow **or** a registered preset name that is standalone-only; reviewed preset names such as `intent-reviewed` stay `unknown-workflow` (rules out treating every registry key as a valid stage `workflow` value).
- New validation code `standalone-only-workflow` on field `workflow`, with `stageId` and a message naming the stage and preset (rules out overloading `unknown-workflow` or `unrealizable-review-posture`).
- Evaluate standalone-only refusal after confirming the string is a registered standalone-only preset and before emitting `unknown-workflow` (rules out classifying reserved standalone names as unknown).
- Standalone-only stages skip review-posture and role-binding checks once refused (rules out duplicate errors on an already-invalid stage).
- Export a small predicate from `workflow-presets.ts` for eligibility lookup so `pipeline-definition.ts` does not import builder functions (rules out duplicating registry keys in the validator).

## Tasks

- [ ] Refactor `workflow-presets.ts` so each preset carries `pipelineStageEligible` alongside its builder; keep `CliWorkflowPresetName` aligned with registered builders.
- [ ] Add `review-feedback` metadata entry with `pipelineStageEligible: false` per the reservation decision above.
- [ ] Wire `validateWorkflowStage` in `pipeline-definition.ts` to emit `standalone-only-workflow` when `workflow` names a registered standalone-only preset.
- [ ] Extend `PipelineValidationError`’s `code` union with `standalone-only-workflow`.
- [ ] Add regression coverage in `pipeline-definition-validation.test.ts`; keep existing registry and posture tests green.

## Acceptance criteria

- [ ] `pipeline-definition-validation.test.ts` test `standalone-only workflow preset is rejected with standalone-only-workflow`: a definition whose workflow stage uses `workflow: "review-feedback"` fails with `code: "standalone-only-workflow"`, `field: "workflow"`, and a message naming the stage; fails against pre-fix validator code.
- [ ] The same test file proves `intent`, `plan`, and `implement` workflow stages still validate clean under the same agent model config fixture used for existing posture tests (reachable on main via current `BASE_WORKFLOW_NAMES` admission).
- [ ] `pipeline-definition-validation.test.ts` test `unknown-workflow names stage ID and workflow field in the message` stays green (`intent-reviewed` remains `unknown-workflow`, not `standalone-only-workflow`).
- [ ] `pipeline-definition-validation.test.ts` test `every registered definition validates clean when all review roles are bound` stays green.
- [ ] `v2/docs/workflow-runner.md` § Pipeline definitions documents standalone-only preset eligibility versus base pipeline stage workflows and lists `standalone-only-workflow` in the validation table.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § Pipeline definitions — standalone-only presets versus base `workflow` values and the `standalone-only-workflow` validation code.
