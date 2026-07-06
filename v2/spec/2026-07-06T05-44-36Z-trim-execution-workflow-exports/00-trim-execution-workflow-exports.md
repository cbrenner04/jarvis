# Trim execution/workflow exports

Listed symbols in `v2/src/execution/` are exported but have no importers outside their defining file. Drop `export` where still used in-file; delete symbols unused even internally. No runtime behavior change.

## Decisions

- De-export or delete intent-listed symbols only — rules out refactors, renames, or new helpers in touched modules.
- **Exempt:** `WorkflowPresetName` and preset machinery in `workflow-runner.ts` — rules out breaking seed 07 consumers.
- No durable doc updates — rules out operator-facing or architecture doc churn for a visibility-only trim.

## Task checklist

- [ ] `review-debate.ts`: de-export `ReviewDebateCycleOutcome`, `ReviewDebateResult` (or delete if unused in-file).
- [ ] `step-runner.ts`: de-export `StepOutcomeToken`, `StepRunInput` (or delete if unused in-file).
- [ ] `workflow-loader.ts`: de-export `LoadWorkflowStepsDeps` (or delete if unused in-file).
- [ ] `workflow-runner.ts`: de-export `WorkflowTelemetryContext`, `ReviewDebateStepAgents`, `validateOnReviseTargets` (or delete if unused in-file); leave preset exports untouched.
- [ ] `write-loop-input.ts`: de-export `DEFAULT_WRITE_STEP_RULES` (or delete if unused in-file).
- [ ] `write-loop.ts`: de-export `WRITE_LOOP_OUTCOME_KINDS` (or delete if unused in-file).
- [ ] `write.ts`: de-export `WriteExecuteResult` (or delete if unused in-file).
- [ ] Fix any in-file references after de-export/delete; do not change call semantics.

## Acceptance criteria

- [ ] `ReviewDebateCycleOutcome`, `ReviewDebateResult`, `StepOutcomeToken`, `StepRunInput`, `LoadWorkflowStepsDeps`, `WorkflowTelemetryContext`, `ReviewDebateStepAgents`, `validateOnReviseTargets`, `DEFAULT_WRITE_STEP_RULES`, `WRITE_LOOP_OUTCOME_KINDS`, and `WriteExecuteResult` are not exported from their defining modules.
- [ ] `WorkflowPresetName`, `defineWorkflowStep`, and `resolveWorkflowPreset` remain exported from `workflow-runner.ts`.
- [ ] `review-debate.test.ts` stays green (behavior unchanged by the trim).
- [ ] `step-runner.test.ts` stays green (behavior unchanged by the trim).
- [ ] `workflow-loader.test.ts` stays green (behavior unchanged by the trim).
- [ ] `workflow-runner.test.ts` stays green (behavior unchanged by the trim).
- [ ] `write-loop-input.test.ts` stays green (behavior unchanged by the trim).
- [ ] `write-loop.test.ts` stays green (behavior unchanged by the trim).
- [ ] `write.test.ts` stays green (behavior unchanged by the trim).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — internal visibility trim with no operator-facing behavior change.
