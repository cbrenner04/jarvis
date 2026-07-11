# Load `review` steps from machine config

Extend `loadWorkflowSteps` so authored `review` steps receive their configured
critic and actuator bindings before workflow execution. The helper currently
accepts only write source steps; programmatic review dispatch already validates
the loaded shape.

## Decisions

- Extend `loadWorkflowSteps` with `review`; rules out a parallel `loadReviewSteps` entrypoint.
- Define discriminated `WorkflowSourceStep` and loaded-step unions for `write | review`; rules out write-only caller assumptions.
- Attach the one loaded machine agent order to both `critic` and `actuator`; rules out authored or divergent role orders.
- Attach the one loaded model config to the review step; rules out builder-owned model loading.
- Select the profile through `resolveMachineProfile(machineConfigPath)` when no profile is injected; rules out changing config-path profile semantics.
- Validate critic and actuator bindings through `validateWorkflowStepRoles` during loading; rules out runtime-only role failures.
- Keep loader input limited to `write | review`; rules out inventing bindings for `human` steps or adding `review-debate` loading in this change.

## Task checklist

- [ ] Define the `write | review` source and loaded unions, with review's fixed critic/actuator order record and no write `role`, while preserving write source behavior.
- [ ] Construct the review role-order record from the configured machine order or `DEFAULT_WRITE_AGENTS`, attach the shared loaded model config, and preserve aggregated role validation.
- [ ] Preserve profile lookup from the supplied machine-config path when no profile is injected.
- [ ] Add loader coverage for a multi-agent successful review step and simultaneous critic/actuator binding misses across the loaded order.
- [ ] Update the workflow-runner loading contract and v1 parity catalog.

## Acceptance criteria

- [ ] `loadWorkflowSteps` accepts discriminated authored `write | review` steps and returns their matching loaded union; a review has only fixed `critic` and `actuator` orders, while a write retains its `role`.
- [ ] `loadWorkflowSteps` returns an authored review step with every configured agent assigned to both critic and actuator plus the loaded model configuration; a supplied machine config path still selects its profile through `resolveMachineProfile` when no profile override is supplied.
- [ ] Missing critic and actuator bindings for every loaded agent fail synchronously with one error naming every `(stepId, role, agent)` tuple before the loader returns steps.
- [ ] Existing `workflow-loader.test.ts` write-step cases stay green.
- [ ] `v2/src/execution/workflow-loader.test.ts` covers multi-agent review loading, config-path profile selection, and aggregated critic/actuator binding misses across both roles and agents.
- [ ] `v2/docs/workflow-runner.md` documents discriminated `write | review` source/loaded unions, review's fixed role record and no write `role`, shared machine-derived review orders/configuration, load-time aggregated validation, and that human and review-debate steps remain outside this loader; `v2/docs/v1-behaviors.md` records the v2-only loader behavior with sources.

## Documentation updates

- `v2/docs/workflow-runner.md` — document review workflow-source loading.
- `v2/docs/v1-behaviors.md` — record the v2-only loader behavior and governing sources.
