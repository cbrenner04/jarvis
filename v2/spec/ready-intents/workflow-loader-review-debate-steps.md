---
name: workflow-loader-review-debate-steps
---

# Load `review-debate` workflow steps from machine configuration

Extend the workflow source loader so authored `review-debate` steps receive configured bindings for every debate role before execution.

## Decisions

- Extend the shared workflow loader for `review-debate`; rules out a debate-specific loader.
- Give adversary, advocate, adjudicator, and actuator the loaded machine agent order and shared model config; rules out leaving debate bindings runtime-only.
- Aggregate every missing `(stepId, role, agent)` tuple at load; rules out failing on the first role or deferring validation to the runner.
- Keep `human` steps outside loader input; rules out inventing bindings for steps with none.

## Scope

- Source `review-debate` steps omit config-derived agents and model configuration.
- Loading constructs all four role orders from the machine configuration, attaches the loaded model configuration, and validates every role binding.
- Cover successful loading and multi-role aggregated binding misses.
- Document non-write debate loading in `v2/docs/workflow-runner.md`.

## Prerequisites

- Write workflow source loading is implemented.
- `review-debate` workflow behavior is implemented.

## Out of scope

- Review or plan preset authoring.
- Human-step loading.
- YAML or config-file workflow authoring.
