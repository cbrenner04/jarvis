# Load `review-debate` steps from machine config

Extend `loadWorkflowSteps` (`v2/src/execution/workflow-loader.ts`) so an authored
`review-debate` source step is loaded with configured bindings for all four debate
roles before execution. Today the loader accepts only `write` source steps and its
doc calls `review-debate` loading out of scope.

## Decisions

- Extend `loadWorkflowSteps` to accept a `write | review-debate` source-step union; rules out a separate debate loader.
- Represent an authored debate step as `ReviewDebateWorkflowStep` minus `agents`/`agentModelConfig`; rules out a bespoke unshared shape.
- Set every debate role order (`adversary`, `advocate`, `adjudicator`, `actuator`) to the one loaded machine agent order; rules out per-role authored orders.
- Attach the single loaded `agentModelConfig` to the debate step; rules out leaving debate model config runtime-only.
- Reuse `validateWorkflowStepRoles` for binding validation so debate misses aggregate as `(stepId, role, agent)` tuples across all roles; rules out first-role-fail or deferring to the runner.
- Loader input stays `write | review-debate` only; `human` steps remain outside loader input.

## Task checklist

- [ ] Add a `review-debate` source-step type (`ReviewDebateWorkflowStep` minus `agents`/`agentModelConfig`) and widen `loadWorkflowSteps` input to the union.
- [ ] For a debate step, build the four-role `agents` record from the loaded machine order and attach the loaded `agentModelConfig`.
- [ ] Route both step kinds through `validateWorkflowStepRoles` so binding misses aggregate across every role.
- [ ] Add loader tests: successful debate load; multi-role aggregated binding miss.
- [ ] Update the "Loading workflow steps" section of `v2/docs/workflow-runner.md`.

## Acceptance criteria

- [ ] `loadWorkflowSteps` accepts a `review-debate` source step and returns it with each of `adversary`, `advocate`, `adjudicator`, and `actuator` set to the loaded machine agent order and the loaded `agentModelConfig` attached.
- [ ] A `review-debate` source step whose loaded agents miss bindings for more than one role fails with one aggregated error naming every missing `(stepId, role, agent)` tuple, not just the first.
- [ ] Existing write-step loader behavior (agent/config attach, `DEFAULT_WRITE_AGENTS` fallback, `operator`/out-of-union role rejection, config-load surfacing) stays green — `workflow-loader.test.ts` write-step tests unchanged.
- [ ] New `workflow-loader.test.ts` cases cover successful `review-debate` loading and a multi-role aggregated binding miss.
- [ ] `v2/docs/workflow-runner.md` "Loading workflow steps" no longer states `review-debate` loading is out of scope and describes four-role order construction, model-config attach, and aggregated `(stepId, role, agent)` validation; `human` steps remain documented as outside loader input.

## Documentation updates

- `v2/docs/workflow-runner.md`: revise the "Loading workflow steps" section for `review-debate` loading (four-role orders, model-config attach, aggregated validation); keep `human` steps out of loader input.
