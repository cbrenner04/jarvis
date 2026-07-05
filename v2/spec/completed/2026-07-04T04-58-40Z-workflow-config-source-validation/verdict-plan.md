- Pin the new failure mode as **workflow-source validation of the loaded step array**, not a restatement of config-load validation that already rejects missing required `(agent, role)` entries. The spec must make clear what additional invalid workflow state is being caught at workflow load.

- Normalize the error contract to include the offending **agent** everywhere it matters. The draft currently mixes `stepId + role` with `(stepId, role, agent)`; aggregated load failures need one consistent observable surface.

- Choose and state the **enforcement seam**. The spec must say whether invalid workflows are rejected by a distinct load API before execution, or by `executeWorkflow` as a mandatory pre-run gate. Deferring parser/carrier is acceptable; deferring where enforcement happens is not.

- Classify **unknown workflow roles** explicitly. The spec must say whether a step naming a role absent from the loaded config is reported as an unknown workflow role, as per-agent missing bindings, or both. This is observable and currently left implicit.

- State the **resume contract** under current config. If validation runs at workflow load, the spec must say whether a resumed workflow is revalidated against the machine config loaded at resume time. Existing runner resume behavior makes this a real contract choice.

- Preserve the stronger **no durable-state change before validation success** guarantee. “Before any step runs” is not enough if existing workflow docs already promise validation failures happen before any persisted workflow state changes.

- Decide whether this is a change to existing documented behavior that also requires updating **`v2/docs/v1-behaviors.md`**. The spec guidance requires parity-baseline updates when existing functionality changes; the draft should either include that doc or make the net-new-only case explicit.
