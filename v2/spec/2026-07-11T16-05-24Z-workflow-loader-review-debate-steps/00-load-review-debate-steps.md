# Load `review-debate` steps from machine config

## Problem

`loadWorkflowSteps` (`v2/src/execution/workflow-loader.ts`) only loads `write`
steps: its input `WorkflowSourceStep = Omit<WriteWorkflowStep, "agents" |
"agentModelConfig">` names one `role` and it attaches one flat `agents` order.
A `review-debate` step instead carries `agents: Record<ReviewDebateRole,
readonly string[]>` — four independent orders keyed by role (`adversary`,
`advocate`, `adjudicator`, `actuator`) — plus `agentModelConfig`. Authored
`review-debate` steps therefore cannot be loaded; today they exist only as
hand-built object literals. The runner already validates loaded debate steps:
`validateWorkflowStepRoles` (`workflow-runner.ts`) aggregates misses as
`(stepId, role, agent)` tuples across all four debate roles. The gap is the
loader building the four-role `agents` + `agentModelConfig` so that validator
can run.

## Decisions

- Accept an authored `review-debate` source step in `loadWorkflowSteps` and dispatch on `behavior`; rules out a separate debate-specific loader.
- Set all four debate-role orders to the one loaded machine agent order (same fallback to `DEFAULT_WRITE_AGENTS` as write); rules out per-role distinct orders — no config surface names them.
- Attach the single loaded `agentModelConfig` to the debate step unchanged; rules out debate-specific model resolution.
- Delegate binding validation to the runner's exported `validateWorkflowStepRoles`; rules out a second loader-local aggregation that could drift from the runner's `(stepId, role, agent)` tuple format.
- Loader input union admits `write` and `review-debate` authored steps only, never `human`; rules out inventing bindings for a step type with no role.

## Task checklist

- Extend the loader input to a union of the write source step and a `review-debate` source step (`ReviewDebateWorkflowStep` minus `agents`/`agentModelConfig`).
- Dispatch on `behavior`: for `review-debate`, build `agents` as all four `ReviewDebateRole` orders set to the loaded machine order and attach `agentModelConfig`; keep write handling as-is.
- Return the loaded `review-debate` step alongside loaded write steps; run the whole result through `validateWorkflowStepRoles` before returning.
- Add loader tests: successful four-role debate load, and aggregated multi-role binding misses.
- Update `v2/docs/workflow-runner.md`.

## Acceptance criteria

- [ ] `loadWorkflowSteps` accepts an authored `review-debate` step (naming no `agents`/`agentModelConfig`) and returns a loaded step whose `agents` has all four of `adversary`, `advocate`, `adjudicator`, `actuator` set to the loaded machine agent order.
- [ ] The loaded `review-debate` step carries the loaded `agentModelConfig`, and its four role orders fall back to `DEFAULT_WRITE_AGENTS` when machine config has no `agents` key.
- [ ] Loading a `review-debate` step whose config is missing bindings for more than one debate role throws one error naming every missing `(stepId, role, agent)` tuple (all misses aggregated, not just the first role).
- [ ] Existing `workflow-loader.test.ts` write-step cases stay green (write loading unchanged by the extension).
- [ ] The loader input type admits `write` and `review-debate` authored steps but not `human` steps (verified by `bun run typecheck`).
- [ ] `v2/docs/workflow-runner.md` documents non-write `review-debate` loading: the "Loading workflow steps" section no longer lists `review-debate` as out of scope, and the "Review-debate dispatch" closing note reflects that `workflow-loader.ts` now loads it.

## Documentation updates

- `v2/docs/workflow-runner.md`: extend "Loading workflow steps" to cover four-role debate loading; update the "Review-debate dispatch" scope note. `human` loading stays out of scope.
- No `v2/docs/v1-behaviors.md` change: this is net-new v2 loader capability, not a change to existing v1 behavior.
