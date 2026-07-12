# Load `review-debate` steps from machine config

Extend `loadWorkflowSteps` (`v2/src/execution/workflow-loader.ts`) so an authored
`review-debate` source step is loaded with configured bindings for all four debate
roles before execution. Today the loader accepts only `write` source steps and its
doc calls `review-debate` loading out of scope.

## Decisions

- Extend `loadWorkflowSteps` to accept a `write | review-debate` source-step union; rules out a separate debate loader.
- Make the source-step input a `behavior`-discriminated shape and branch loading on `behavior`: the `write` branch keeps its single-`role` executability pre-check and flat `agents` array attach; the `review-debate` branch skips the single-`role` pre-check and constructs the four-role `ReviewDebateStepAgents` record; rules out reusing the write single-`role`/flat-array path for a debate step that has no single `role` field.
- Widen the loader return type to `write | review-debate` loaded-step union; rules out leaving the return type write-only and the doc signature stale.
- Represent an authored debate step as `ReviewDebateWorkflowStep` minus `agents`/`agentModelConfig`; rules out a bespoke unshared shape.
- Set every debate role order (`adversary`, `advocate`, `adjudicator`, `actuator`) to the one loaded machine agent order; rules out per-role authored orders.
- Debate roles inherit the same absent-config default order the write path uses (`DEFAULT_WRITE_AGENTS`), degrading cleanly into aggregated validation; rules out failing the load when machine config yields no order.
- Attach the single loaded `agentModelConfig` to the debate step; rules out leaving debate model config runtime-only.
- Reuse `validateWorkflowStepRoles` for binding validation so debate misses aggregate as `(stepId, role, agent)` tuples across all roles; rules out first-role-fail or deferring to the runner.
- Loader input stays `write | review-debate` only; `human` steps remain outside loader input.

## Task checklist

- [ ] Add a `review-debate` source-step type (`ReviewDebateWorkflowStep` minus `agents`/`agentModelConfig`), widen `loadWorkflowSteps` input to the `behavior`-discriminated union, and widen its return type to the `write | review-debate` loaded-step union.
- [ ] Branch loading on `behavior`: skip the single-`role` executability pre-check for a debate step and build the four-role `ReviewDebateStepAgents` record from the loaded machine order (default order when config yields none), attaching the loaded `agentModelConfig`.
- [ ] Route both step kinds through `validateWorkflowStepRoles` so binding misses aggregate across every role.
- [ ] Add loader tests: successful debate load; multi-role aggregated binding miss.
- [ ] Update the "Loading workflow steps" section of `v2/docs/workflow-runner.md`.

## Acceptance criteria

- [x] `loadWorkflowSteps` accepts a `review-debate` source step and returns it with each of `adversary`, `advocate`, `adjudicator`, and `actuator` set to the loaded machine agent order and the loaded `agentModelConfig` attached.
- [x] A `review-debate` source step whose loaded agents miss bindings for more than one role fails with one aggregated error naming every missing `(stepId, role, agent)` tuple, not just the first.
- [x] Existing write-step loader behavior (agent/config attach, `DEFAULT_WRITE_AGENTS` fallback, `operator`/out-of-union role rejection, config-load surfacing) stays green — `workflow-loader.test.ts` write-step tests unchanged.
- [x] New `workflow-loader.test.ts` cases cover successful `review-debate` loading and a multi-role aggregated binding miss.
- [x] `v2/docs/workflow-runner.md` "Loading workflow steps" no longer states `review-debate` loading is out of scope, documents the widened `write | review-debate` loader input and return type, and describes four-role order construction, model-config attach, and aggregated `(stepId, role, agent)` validation; `human` steps remain documented as outside loader input.

## Documentation updates

- `v2/docs/workflow-runner.md`: revise the "Loading workflow steps" section for `review-debate` loading (widened `write | review-debate` input and return type, four-role orders, model-config attach, aggregated validation); keep `human` steps out of loader input.
