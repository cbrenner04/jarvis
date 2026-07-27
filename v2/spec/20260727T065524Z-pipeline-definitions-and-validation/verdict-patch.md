Verifying the binding documentation and runtime resolution against the implementation.


## Verdict — required outcomes

1. **Correct the role-binding documentation in `v2/docs/workflow-runner.md`.**  
   The section must state the admission rule exactly as implemented and specified: a role is satisfied when **any** agent entry in the supplied `AgentModelConfig` has that role key. It must **not** say this “matches” run-time role→model resolution. Run time uses `resolveInvocationBindings`, which requires the role on **every** agent in the step’s agent list. Readers (especially the slice that wires admission) need that distinction so they do not treat passing `validatePipelineDefinition` as guaranteeing run-time binding success for asymmetric or hand-built configs.

2. **Add the two explicit subspec 00 deferrals to `v2/docs/workflow-runner.md` in the pipeline-definitions section.**  
   - `unknown-pipeline` from `getPipelineDefinition` is defined for totality only; no operator/CLI surface reports it yet (deferred until a pipeline-selecting entry point exists).  
   - Precedence between a pipeline stage’s `review` on `implement` and per-project implement review behavior from the machine-config loader is **not** decided in this slice; nothing consumes stage posture at run time yet.  
   Omitting these invites wrong assumptions about CLI errors and implement review ownership.

3. **No validator, registry, or type changes are required for spec compliance.**  
   Six error codes, unrealizable cells, registry contents, total lookup, multi-error passes, `workflow`/`review` as `string`, and key-presence binding match subspecs 00 and 01. Absence of an exported `(workflow, review) → preset/builder` resolver is in scope for a later execution slice, not this patch.

**Rationale:** Subspec 01’s documentation AC requires an accurate role-binding definition anchored to the resolution consumer family, not an overstated equivalence. Subspec 00 records operator-surface and implement-posture deferrals as decisions; durable operator/architecture docs should carry them alongside the lookup and validation material already added. Implementation and tests otherwise satisfy the checked acceptance criteria; remaining critiques (error cascading, weaker regression tests, `intent.md` drift, registry freeze) are quality improvements, not blockers for closing this patch.