# Load `review` source steps in `loadWorkflowSteps`

Extend `loadWorkflowSteps` (`v2/src/execution/workflow-loader.ts`) so a
`behavior: "review"` source step materializes its config-derived `agents` and
`agentModelConfig` from machine config, alongside the existing `write` path.
Today the helper accepts only `WriteWorkflowStep` minus config, and the
review-dispatch doc records that the loader "still assumes one `role` per step."

## Decisions

- `WorkflowSourceStep` becomes a `behavior`-discriminated union: the existing write variant plus `Omit<ReviewWorkflowStep, "agents" | "agentModelConfig">`; rules out a separate `loadReviewSteps` entrypoint.
- A loaded review step gets `agents: { critic: <order>, actuator: <order> }` — the one machine agent order applied to both roles; rules out divergent per-role orders.
- Both loaded roles share the one loaded `agentModelConfig`; rules out a second per-role model load.
- Review-step role validation reuses `validateWorkflowStepRoles` (already aggregates `(stepId, role, agent)` misses over critic+actuator × every agent); rules out a bespoke review validator.
- The per-step `resolveExecutableRole(step.role)` guard branches on `behavior`: for review steps it checks `critic` and `actuator` rather than a single `step.role`; rules out reading `.role` off a review step.
- Human and `review-debate` source steps stay unsupported by the loader; rules out widening the union past `review`.

## Task checklist

- Widen `WorkflowSourceStep` to the write|review union.
- In `loadWorkflowSteps`, attach `agents`/`agentModelConfig` per `behavior` and keep non-config review fields (`prompt`, `verdictPath`, `maxCycles`, `cwd`, `project`, `branch`, `deferredIntentOutput`, `createBinding`) untouched.
- Branch the executable-role guard for review steps over `critic`/`actuator`.
- Add loader tests: successful review load + aggregated critic/actuator binding misses.
- Update `v2/docs/workflow-runner.md`.

## Acceptance criteria

- [ ] Loading a `behavior: "review"` source step returns a step whose `agents.critic` and `agents.actuator` both equal the loaded machine agent order and whose `agentModelConfig` is the loaded config.
- [ ] Loading a review source step preserves its authored non-config fields (`prompt`, `verdictPath`, `maxCycles`, `cwd`, `project`, `branch`, `deferredIntentOutput`) unchanged.
- [ ] Loading a review source step whose config lacks bindings for `critic` and `actuator` on a loaded agent throws one aggregated error naming every missing `(stepId, role, agent)` for both roles.
- [ ] Existing `loadWorkflowSteps` write-step tests in `workflow-loader.test.ts` stay green (write path unchanged by the union).
- [ ] `v2/docs/workflow-runner.md` documents that the loader materializes `review` source steps (critic+actuator share one loaded order and one model config) and no longer states the loader assumes one `role` per step.

## Documentation updates

- `v2/docs/workflow-runner.md`: revise the "Loading workflow steps" section for the review variant; drop the "workflow-loader.ts ... still assumes one `role` per step" note in the review-debate section.
