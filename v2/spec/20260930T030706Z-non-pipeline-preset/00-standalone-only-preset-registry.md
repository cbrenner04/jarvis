# Standalone-only preset registry and pipeline refusal

Pipeline stage `workflow` values today are only `intent`, `plan`, and `implement` (`BASE_WORKFLOW_NAMES`). Standalone-only CLI presets (first consumer: review-feedback re-entry) must be registrable without implying pipeline composability. `validatePipelineDefinition` must reject a stage whose `workflow` names a registered standalone-only preset with an error distinct from `unknown-workflow`, while base workflows keep today’s posture and role-binding rules.

## Decisions

- Add a separate `PIPELINE_ELIGIBILITY` table in `v2/src/execution/workflow-presets.ts`, keyed by preset name, whose keys are a superset of `WORKFLOW_PRESET_BUILDERS` keys (type-enforced), so a standalone-only name can be registered before its builder exists (rules out a stub `review-feedback` builder and rules out per-builder colocated metadata).
- Every existing `WORKFLOW_PRESET_BUILDERS` key defaults to `pipelineStageEligible: true` in that table (rules out opt-in eligibility for shipped presets).
- Register `review-feedback` in the eligibility table only, with `pipelineStageEligible: false`; `WORKFLOW_PRESET_BUILDERS` is unchanged in this subspec.
- `CliWorkflowPresetName` stays `keyof typeof WORKFLOW_PRESET_BUILDERS` (builder-backed names only); the eligibility table's key type is `CliWorkflowPresetName | "review-feedback"` (rules out exposing `review-feedback` as a runnable CLI preset before its builder lands).
- A stage `workflow` naming a standalone-only preset is refused with validation code `standalone-only-workflow`; reviewed preset names such as `intent-reviewed` stay `unknown-workflow` (rules out treating any registry key as a valid stage `workflow` value).
- New validation code `standalone-only-workflow` on field `workflow`, with `stageId` and a message naming the stage and preset (rules out overloading `unknown-workflow` or `unrealizable-review-posture`).
- Evaluate standalone-only refusal after confirming the string is a registered standalone-only preset and before emitting `unknown-workflow` (rules out classifying reserved standalone names as unknown).
- Standalone-only stages skip review-posture and role-binding checks once refused (rules out duplicate errors on an already-invalid stage).
- Export a small predicate from `workflow-presets.ts` for eligibility lookup so `pipeline-definition.ts` does not import builder functions (rules out duplicating registry keys in the validator).

## Tasks

- [ ] Add `PIPELINE_ELIGIBILITY` to `workflow-presets.ts` covering every `WORKFLOW_PRESET_BUILDERS` key (`true`) plus `review-feedback` (`false`); leave builders and `CliWorkflowPresetName` unchanged.
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
- `v2/docs/pipeline-execution.md` — list `standalone-only-workflow` beside `unknown-workflow`.
- `v2/docs/v1-behaviors.md` — record the new pipeline refusal of standalone-only stage workflows.
