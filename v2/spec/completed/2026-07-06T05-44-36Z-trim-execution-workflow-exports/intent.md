---
name: trim-execution-workflow-exports
---

# Trim execution and workflow public surface

Drop `export` where symbols have no reference outside their file; delete outright if unused internally. Execution/workflow scope: `review-debate` (`ReviewDebateCycleOutcome`, `ReviewDebateResult`) · `step-runner` (`StepOutcomeToken`, `StepRunInput`) · `workflow-loader` (`LoadWorkflowStepsDeps`) · `workflow-runner` (`WorkflowTelemetryContext`, `ReviewDebateStepAgents`, `validateOnReviseTargets`) · `write-loop-input` (`DEFAULT_WRITE_STEP_RULES`) · `write-loop` (`WRITE_LOOP_OUTCOME_KINDS`) · `write.ts` (`WriteExecuteResult`). No behavior change beyond visibility.

## Decisions

- De-export or delete listed symbols only — rules out refactors, renames, or new helpers.
- **Exempt:** `WorkflowPresetName` and preset machinery — rules out touching seed 07 consumers.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are landed (seed 01)

## Documentation updates

- None — internal visibility trim with no operator-facing behavior change

## Verification

- `bun run typecheck`, `test:v2`, `test:integration:v2`
