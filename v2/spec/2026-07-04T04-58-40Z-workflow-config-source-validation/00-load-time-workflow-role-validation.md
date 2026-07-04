# Load-time workflow role validation

Validate workflow source steps against the loaded config before any step runs.
Each step role must resolve for every machine-configured agent under the
load-time rules in [`v2/docs/agent-model-config.md`](../../docs/agent-model-config.md).

## Decisions

- Validate workflow-source roles once at workflow load, not lazily at first failing invocation.
- Validate only against the machine-configured `agents` order plus the loaded workflow steps, not every agent cataloged in `data/agent-model-config.json`.
- Missing `(agent, role)` for any configured agent is a hard load error even if an earlier agent has that role; this rules out partial outer-loop coverage.
- Report workflow-source validation errors with the offending `stepId` and role, not role-only or index-only messages.
- Aggregate all missing role bindings found in one workflow load, not fail-fast on the first invalid step; the source and config are both hand-edited.
- Keep `executeWorkflow`'s linear run semantics unchanged for already-valid step arrays; this rules out mixing source validation into mid-run control flow.
- Deferred to first consumer: exact workflow-definition file format and parser entrypoint — pin when a caller needs it.
- Deferred to first consumer: outer CLI/API error carrier for workflow-load failures — pin when a caller needs it.

## Task checklist

- [ ] Add a workflow-load validation seam that checks every step role against the loaded `AgentModelConfig` and machine-configured `agents` before execution starts.
- [ ] Reject workflow loads where any step role is missing for any configured agent, surfacing every offending `(stepId, role, agent)` miss in one load error.
- [ ] Cover valid-load, single-miss, multi-miss, and "earlier agent has it, later fallback agent does not" cases with tests.
- [ ] Keep the existing linear workflow-runner behavior green for already-valid step arrays.

## Acceptance criteria

- [ ] Loading a workflow whose every step role exists for every machine-configured agent succeeds and the workflow can start.
- [ ] Loading a workflow with a step whose role is missing for any machine-configured agent fails before any step runs and names the offending step and role.
- [ ] Loading a workflow with multiple missing role bindings reports all offending misses in one load result, not one-at-a-time.
- [ ] A role binding present for an earlier configured agent but missing for a later configured fallback agent still fails workflow load.
- [ ] `v2/src/execution/workflow-runner.test.ts` linear-step tests stay green for already-valid step arrays.

## Documentation updates

- Update `v2/docs/agent-model-config.md` load-time validation to state that workflow-source steps are checked against every machine-configured agent before a workflow is allowed to run, with no deferred first-invocation fallback.
- Update `v2/docs/workflow-runner.md` validation/execution contract to distinguish workflow-load role validation from runtime step execution and to describe the load error surface in terms of offending step IDs and roles.
