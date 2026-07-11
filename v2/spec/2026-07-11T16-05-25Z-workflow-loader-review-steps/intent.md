---
name: workflow-loader-review-steps
---

# Load `review` workflow steps from machine configuration

Extend the workflow source loader to materialize `review` steps from the machine agent order and model profile, then route reviewed-intent construction through that one loader pipeline.

## Decisions

- Extend `loadWorkflowSteps` for `review`; rules out a parallel `loadReviewSteps` entrypoint.
- Give both `critic` and `actuator` the loaded machine agent order and shared model config; rules out builder-owned config loading or divergent role orders.
- Aggregate missing `(stepId, role, agent)` bindings at load before a builder returns steps; rules out runtime-only role failures.
- Keep `human` steps outside loader input; rules out inventing bindings for steps with none.

## Scope

- Source `review` steps omit config-derived agents and model configuration.
- Loading attaches the configured agent order to critic and actuator, attaches one loaded model configuration, and validates both roles for every agent.
- The reviewed-intent builder uses the loader for its write and review steps, preserving its existing review composition and caller-facing failure result.
- Cover successful loading and aggregated critic/actuator binding misses.
- Document non-write review loading in `v2/docs/workflow-runner.md`.

## Prerequisites

- Write workflow source loading is implemented.
- `review` workflow behavior is implemented.

## Out of scope

- `review-debate` loading.
- Human-step loading.
- YAML or config-file workflow authoring.
