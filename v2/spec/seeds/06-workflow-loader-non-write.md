# Workflow loader for `review` and `review-debate` steps

Extend `loadWorkflowSteps` (or successor) so authored workflows can include
non-write steps with `agents` / `agentModelConfig` attached and role bindings
validated at load time.

## Scope

- Load `behavior: "review"` steps: validate `critic` + `actuator` per agent.
- Load `behavior: "review-debate"` steps: validate four debate roles per agent
  (today runtime-only).
- Aggregated `(stepId, role, agent)` error tuples — same pattern as write-step
  validation.
- Builders for intent/plan/implement presets use loader for all step types in
  one pipeline.

## Decisions

- Single loader entrypoint; no parallel `loadReviewSteps`.
- Human steps still out of loader scope (no role bindings).

## Prerequisites

- `review` behavior merged (seed 00).

## Out of scope

- YAML/config workflow files.
- Human step loading.

## Reference

- `.scratch/v2-operator-workflows.md` — cross-cutting loader, seed 06

## Documentation updates

- `v2/docs/workflow-runner.md` — Loading workflow steps (non-write)
