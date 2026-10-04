# Load workflow steps from machine config and agent model config

`executeWorkflow` already rejects a step role missing an `(agent, role)`
entry for any agent in `step.agents`, aggregated as a single hard error before
any step runs (`workflow-runner.ts`'s `validateWorkflowStepRoles`). But
nothing assembles `step.agents`/`step.agentModelConfig` from the machine's
configured agent fallback order and the global `AgentModelConfig` — every
caller (today, only tests) supplies both by hand. A workflow definition that
only names a role per step has no path to real config.

## Decisions

- Entry point: `loadWorkflowSteps(steps: WorkflowSourceStep[]): WorkflowStep[]`,
  an in-memory function — the "workflow source" is an authored array literal,
  not an on-disk file — rules out inventing a file format this intent doesn't
  need. `WorkflowSourceStep` is `WorkflowStep` minus `agents` and
  `agentModelConfig`.
- The loader loads the machine's configured agent order and the global
  `AgentModelConfig` once, attaches the same order/config to every step (no
  per-step override), and runs the existing role-resolution check before
  returning — rules out silently deferring that check to whenever
  `executeWorkflow` is later called with hand-built steps.
- When machine config has no `agents` key (`loadMachineConfig` returns
  `undefined`), the loader falls back to `DEFAULT_WRITE_AGENTS`
  (`["claude"]`), matching the precedence documented in
  `v2/docs/agent-model-config.md` (CLI override > machine config > default) —
  rules out treating "no machine config" as a load error.
- Machine config or `AgentModelConfig` load failure (already-validated rules
  in `machine-config-loader.ts` / `agent-model-config.ts`) surfaces as-is; the
  loader adds no new config-shape validation of its own.
- Collapsing per-step `agents`/`agentModelConfig` to one workflow-wide
  order/config is an observable behavior change from what `WorkflowStep`
  permits today (per-step divergence). Deferred to first consumer: a step
  needing a different agent order or config than its siblings — pin when a
  caller needs it.
- A step naming `role: "operator"` is rejected at load, consistent with
  `resolveExecutableRole` rejecting it before invocation — rules out letting
  a non-executable role reach `executeWorkflow` only to fail later at whatever
  step happens to run first.
- Scope: `AgentModelConfig` load already hard-errors unless every non-operator
  role has an entry for every configured agent, so a successful config load
  leaves only two things this check can still catch: a step role that's a
  typo not in the closed `Role` union, or a step naming `role: "operator"`.
- This check is additive to, not a replacement for, `executeWorkflow`'s own
  `validateWorkflowStepRoles`, which still runs unconditionally on every
  invocation (including resume) regardless of whether steps came from this
  loader.
- This check runs once at workflow load, not per-step at invocation time.

## Task Checklist

- [ ] Add `WorkflowSourceStep`: same shape as `WorkflowStep` minus `agents`
      and `agentModelConfig`.
- [ ] Add `loadWorkflowSteps(steps: WorkflowSourceStep[]): WorkflowStep[]`:
      loads the machine agent order (falling back to `DEFAULT_WRITE_AGENTS`
      when absent) and `AgentModelConfig`, attaches both to every step,
      rejects any step naming `role: "operator"` or a role outside the closed
      `Role` union, validates every remaining step's role resolves for every
      loaded agent, and returns the validated `WorkflowStep[]` (or throws the
      aggregated hard error naming each offending step/role/agent).
- [ ] Export the existing per-step role-resolution check for reuse by the
      loader instead of duplicating it.

## Documentation updates

- Update `v2/docs/workflow-runner.md` to describe the new loader and where it
  sits ahead of `executeWorkflow` in the pipeline.
- Correct `v2/docs/agent-model-config.md` (Load-time validation section,
  ~lines 249-257) to describe the actual division of responsibility: this
  loader assembles `agents`/`agentModelConfig` from machine config and the
  data file and runs the load-time role check once; `executeWorkflow` still
  separately validates on every invocation.

## Acceptance criteria

- [x] Loading a workflow source whose step names a role with no `(agent,
      role)` entry for one of the machine's configured agents fails before
      any step executes, and the error names the offending step and role.
- [x] Loading a workflow source whose steps all resolve for every configured
      agent succeeds and produces steps that run via the existing workflow
      runner unchanged.
- [x] A workflow source with multiple missing step/role/agent bindings fails
      with all of them named in one load error, not just the first.
- [x] Loading a workflow source when machine config has no `agents` key
      succeeds using `DEFAULT_WRITE_AGENTS` as the agent order.
- [x] Loading a workflow source with a step naming `role: "operator"` fails
      at load, naming the offending step.
