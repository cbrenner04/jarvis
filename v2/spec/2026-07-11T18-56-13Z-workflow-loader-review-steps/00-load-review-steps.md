# Load `review` steps from machine config

Extend `loadWorkflowSteps` so authored `review` steps receive their configured
critic and actuator bindings before workflow execution. The helper currently
accepts only write source steps; programmatic review dispatch already validates
the loaded shape.

## Decisions

- Extend `loadWorkflowSteps` with `review`; rules out a parallel `loadReviewSteps` entrypoint.
- Define an authored review step as `ReviewWorkflowStep` without `agents` and `agentModelConfig`; rules out a bespoke source-only review shape.
- Attach the one loaded machine agent order to both `critic` and `actuator`; rules out authored or divergent role orders.
- Attach the one loaded model config to the review step; rules out builder-owned model loading.
- Validate critic and actuator bindings through `validateWorkflowStepRoles` during loading; rules out runtime-only role failures.
- Keep loader input limited to `write | review`; rules out inventing bindings for `human` steps or adding `review-debate` loading in this change.

## Task checklist

- [ ] Widen the workflow-source and loaded-step unions for `review` while preserving write-step source behavior.
- [ ] Construct the review role-order record from the configured machine order or `DEFAULT_WRITE_AGENTS`, attach the shared loaded model config, and preserve aggregated role validation.
- [ ] Add loader coverage for a successfully loaded review step and simultaneous critic/actuator binding misses.
- [ ] Update the workflow-runner loading contract and v1 parity catalog.

## Acceptance criteria

- [ ] `loadWorkflowSteps` accepts an authored `review` step and returns it with the loaded machine agent order assigned to both critic and actuator plus the loaded model configuration.
- [ ] Missing critic and actuator bindings for loaded agents fail synchronously with one error naming every `(stepId, role, agent)` tuple before the loader returns steps.
- [ ] Existing `workflow-loader.test.ts` write-step cases stay green.
- [ ] `v2/src/execution/workflow-loader.test.ts` covers successful review loading and aggregated critic/actuator binding misses.
- [ ] `v2/docs/workflow-runner.md` documents `write | review` loader input/output, shared machine-derived review orders/configuration, load-time aggregated validation, and that human and review-debate steps remain outside this loader; `v2/docs/v1-behaviors.md` records the v2-only loader behavior with sources.

## Documentation updates

- `v2/docs/workflow-runner.md` — document review workflow-source loading.
- `v2/docs/v1-behaviors.md` — record the v2-only loader behavior and governing sources.
