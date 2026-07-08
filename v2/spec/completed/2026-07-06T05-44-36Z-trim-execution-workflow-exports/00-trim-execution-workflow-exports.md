# Trim execution/workflow exports

Listed symbols in `v2/src/execution/` are exported but have no importers outside their defining file. Drop `export` where still used in-file; delete symbols unused even internally. No runtime behavior change.

## Decisions

- De-export or delete intent-listed symbols only — rules out refactors, renames, or new helpers in touched modules.
- In-file-used intent symbols: de-export only, not delete — rules out removing `WRITE_LOOP_OUTCOME_KINDS` and similar runtime references.
- **Seed 02 supersession:** merge completes seed 02 de-export obligation for the eleven execution/workflow symbols in this subspec — rules out a later seed 02 run re-touching these lines; does not cover file deletes, `state-store-types` merge, resume rejection, or duplicate-test removal.
- **Exempt:** `WorkflowPresetName` and preset machinery in `workflow-runner.ts` — rules out breaking seed 07 consumers.
- No durable doc updates — rules out operator-facing or architecture doc churn for a visibility-only trim.

## Task checklist

- [ ] `review-debate.ts`: de-export `ReviewDebateCycleOutcome`, `ReviewDebateResult`.
- [ ] `step-runner.ts`: de-export `StepOutcomeToken`, `StepRunInput`.
- [ ] `workflow-loader.ts`: de-export `LoadWorkflowStepsDeps`.
- [ ] `workflow-runner.ts`: de-export `WorkflowTelemetryContext`, `ReviewDebateStepAgents`, `validateOnReviseTargets`; leave preset exports untouched.
- [ ] `write-loop-input.ts`: de-export `DEFAULT_WRITE_STEP_RULES`.
- [ ] `write-loop.ts`: de-export `WRITE_LOOP_OUTCOME_KINDS`.
- [ ] `write.ts`: de-export `WriteExecuteResult`.
- [ ] Delete intent-listed symbols that are unused even in-file.
- [ ] Fix any in-file references after de-export/delete; do not change call semantics.

## Acceptance criteria

- [x] `ReviewDebateCycleOutcome`, `ReviewDebateResult`, `StepOutcomeToken`, `StepRunInput`, `LoadWorkflowStepsDeps`, `WorkflowTelemetryContext`, `ReviewDebateStepAgents`, `validateOnReviseTargets`, `DEFAULT_WRITE_STEP_RULES`, `WRITE_LOOP_OUTCOME_KINDS`, and `WriteExecuteResult` are not exported from their defining modules.
- [x] `WorkflowPresetName`, `defineWorkflowStep`, and `resolveWorkflowPreset` remain exported from `workflow-runner.ts`.
- [x] `review-debate.test.ts` stays green (behavior unchanged by the trim).
- [x] `step-runner.test.ts` stays green (behavior unchanged by the trim).
- [x] `workflow-loader.test.ts` stays green (behavior unchanged by the trim).
- [x] `workflow-runner.test.ts` stays green (behavior unchanged by the trim).
- [x] `write-loop-input.test.ts` stays green (behavior unchanged by the trim).
- [x] `write-loop.test.ts` stays green (behavior unchanged by the trim).
- [x] `write.test.ts` stays green (behavior unchanged by the trim).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — internal visibility trim with no operator-facing behavior change.
