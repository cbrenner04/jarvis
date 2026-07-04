# Load-time workflow role validation

Validate the loaded workflow step array against the already-loaded config before
execution. This catches invalid workflow-source roles that config load alone
cannot catch: a step naming a role the machine-configured agents do not all bind
under the load-time rules in
[`v2/docs/agent-model-config.md`](../../docs/agent-model-config.md).

## Decisions

- Enforce workflow-source role validation in `executeWorkflow` as a mandatory pre-run gate, not in a separate caller-owned load API.
- Validate the loaded `steps` array against the machine-configured `agents` order plus loaded `AgentModelConfig`, not against every agent cataloged in `data/agent-model-config.json`.
- Treat a workflow step naming a role absent from the loaded config for every configured agent as per-agent missing bindings, not as a separate unknown-role class.
- Missing `(stepId, role, agent)` for any configured agent is a hard workflow-load error even if an earlier agent binds that role; this rules out partial outer-loop coverage.
- Report every workflow-load validation miss as `(stepId, role, agent)`, not step/role-only or role-only messages.
- Aggregate all `(stepId, role, agent)` misses from one loaded step array, not fail-fast on the first invalid step; the source and config are both hand-edited.
- Revalidate a resumed workflow against the machine config and `AgentModelConfig` loaded at resume time, not against only the original run's bindings.
- Reject invalid workflows before any durable workflow state change, not merely before the first step body runs.
- Keep `executeWorkflow`'s linear run semantics unchanged after validation succeeds, not by mixing source validation into mid-run control flow.
- This is net-new v2 workflow validation, not a change to shipped v1 behavior; `v2/docs/v1-behaviors.md` stays untouched.
- Deferred to first consumer: exact workflow-definition file format and parser entrypoint — pin when a caller needs it.
- Deferred to first consumer: outer CLI/API error carrier for workflow-load failures — pin when a caller needs it.

## Task checklist

- [ ] Add an `executeWorkflow` pre-run validation gate that checks the loaded `steps` array against the loaded `AgentModelConfig` and machine-configured `agents` before any durable workflow state change.
- [ ] Reject workflow loads where any step role is missing for any configured agent, surfacing every offending `(stepId, role, agent)` miss in one aggregated load error.
- [ ] Re-run the same validation on resume against the config loaded at resume time.
- [ ] Cover valid-load, unknown-role-as-misses, single-miss, multi-miss, resume-revalidation, and "earlier agent has it, later fallback agent does not" cases with tests.
- [ ] Keep the existing linear workflow-runner behavior green for already-valid step arrays.

## Acceptance criteria

- [ ] `executeWorkflow` accepts a loaded step array only when every step role resolves for every machine-configured agent in the currently loaded `AgentModelConfig`.
- [ ] `executeWorkflow` rejects a loaded step array before any durable workflow state change when any step yields a missing `(stepId, role, agent)` binding under the current config.
- [ ] A step naming a role absent from the loaded config is reported through the same aggregated `(stepId, role, agent)` missing-binding surface, not a separate unknown-role error.
- [ ] One invalid loaded step array reports all offending `(stepId, role, agent)` misses in one load failure, not one-at-a-time.
- [ ] A role binding present for an earlier configured agent but missing for a later configured fallback agent still fails workflow load.
- [ ] Resuming a workflow under changed machine-configured agents or changed `AgentModelConfig` revalidates the loaded step array against that resume-time config before any durable state change or step execution.
- [ ] `v2/src/execution/workflow-runner.test.ts` linear-step tests stay green for already-valid step arrays.

## Documentation updates

- Update `v2/docs/agent-model-config.md` load-time validation to distinguish config-load validation from workflow-source validation of the loaded step array and to state that workflow-source steps are checked against every machine-configured agent before a workflow is allowed to run, with no deferred first-invocation fallback.
- Update `v2/docs/workflow-runner.md` validation/resume contract to state that `executeWorkflow` performs this validation as a pre-run gate, re-runs it on resume against resume-time config, and fails before any durable workflow state change with aggregated `(stepId, role, agent)` misses.
