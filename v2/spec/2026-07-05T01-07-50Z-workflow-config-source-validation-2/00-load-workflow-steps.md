# Load workflow steps from machine config and agent model config

`executeWorkflow` already rejects a step role missing an `(agent, role)`
entry for any agent in `step.agents`, aggregated as a single hard error before
any step runs (`workflow-runner.ts`'s `validateWorkflowStepRoles`). But
nothing assembles `step.agents`/`step.agentModelConfig` from the machine's
configured agent fallback order and the global `AgentModelConfig` — every
caller (today, only tests) supplies both by hand. A workflow definition that
only names a role per step has no path to real config.

## Decisions

- A new loader reads a workflow source (steps naming only `role` plus their
  write-loop fields — no `agents`/`agentModelConfig`), loads the machine's
  configured agent order and the global `AgentModelConfig`, attaches both to
  every step, and runs the existing role-resolution check before returning —
  rules out silently deferring that check to whenever `executeWorkflow` is
  later called with hand-built steps.
- Machine config or `AgentModelConfig` load failure (already-validated rules
  in `machine-config-loader.ts` / `agent-model-config.ts`) surfaces as-is; the
  loader adds no new config-shape validation of its own.

## Task Checklist

- [ ] Add a workflow-source step type: same shape as `WorkflowStep` minus
      `agents` and `agentModelConfig`.
- [ ] Add a loader that takes workflow-source steps, loads the machine agent
      order and `AgentModelConfig`, attaches them to each step, validates
      every step's role resolves for every loaded agent, and returns the
      validated `WorkflowStep[]` (or throws the aggregated hard error naming
      each offending step/role/agent).
- [ ] Export the existing per-step role-resolution check for reuse by the
      loader instead of duplicating it.

## Documentation updates

- Update `v2/docs/workflow-runner.md` to describe the new loader and where it
  sits ahead of `executeWorkflow` in the pipeline.

## Acceptance criteria

- [ ] Loading a workflow source whose step names a role with no `(agent,
      role)` entry for one of the machine's configured agents fails before
      any step executes, and the error names the offending step and role.
- [ ] Loading a workflow source whose steps all resolve for every configured
      agent succeeds and produces steps that run via the existing workflow
      runner unchanged.
- [ ] A workflow source with multiple missing step/role/agent bindings fails
      with all of them named in one load error, not just the first.
