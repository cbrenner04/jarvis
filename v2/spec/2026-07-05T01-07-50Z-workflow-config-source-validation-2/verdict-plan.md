## Verdict: Required Refinements

**1. Handle machine config absence, not just load failure.**
`machine-config-loader.ts` returns `undefined` when no `agents` key is configured — this is a distinct, valid state from a load *failure*, and the subspec's current decision ("load failure surfaces as-is") doesn't cover it. Add a decision stating what the loader does when machine config is absent (per `agent-model-config.md`'s documented precedence, this is `DEFAULT_WRITE_AGENTS`), plus an acceptance criterion covering that path. Without this, the loader's behavior on a common, legitimate config state is unspecified.

**2. State explicitly what the load-time check does and doesn't catch.**
Since `AgentModelConfig` load already hard-errors unless every non-operator role has an entry for every configured agent, a successful load leaves only two failure modes for this check: a typo'd role string, or `role: "operator"` naming a non-executable role. Add a sentence to the Decisions section stating this scope plainly, so the reader isn't left reconstructing it from cross-referenced docs.

**3. Pin the "workflow source" shape and entry point.**
The spec introduces a "workflow-source step type" and a loader that "takes workflow-source steps" but never defines what a workflow source actually is on disk or in code — a function argument (array literal), an on-disk file, or something else — nor names the loader's entry point. Acceptance criteria can't be tied to a concrete test without this. Add a decision pinning the shape/entry point (function signature or file format) before implementation proceeds.

**4. Record the per-step-override loss as an explicit decision.**
`WorkflowStep` today permits per-step `agents`/`agentModelConfig`; the new workflow-source type and loader collapse this to one workflow-wide agent order/config applied to every step. This is an observable behavior change, not an implementation detail — record it as a decision with rationale (e.g., deferred to first consumer needing per-step divergence, per this repo's deferral convention).

**5. Clarify the load-time check is additive to, not a replacement for, `executeWorkflow`'s existing per-invocation check.**
`executeWorkflow`'s `validateWorkflowStepRoles` already runs unconditionally on every invocation, including resume. The new loader's decision ("runs once at load, not per-step at invocation") describes only the new check and could be misread as replacing or superseding the existing one. Add one clarifying sentence: these are two independent checks that both remain in effect.

**6. Extend the Documentation updates target to include `agent-model-config.md`.**
That doc (lines ~249–257) already describes this feature's behavior, and does so inaccurately relative to the actual division of responsibility between the new loader and `executeWorkflow`. The Documentation updates section must list this passage for correction alongside `workflow-runner.md`, per the documentation-standard requirement that behavior changes update the durable doc home, not just add a new one.

**7. State the loader's handling of `role: "operator"`.**
`operator` is a non-executable role explicitly deferred in `agent-model-config.md`, and `resolveExecutableRole` already rejects it before the workflow boundary. The subspec must state whether a workflow source naming `role: "operator"` is rejected at load (consistent with that existing rejection) or handled differently — this is currently unaddressed and is a plausible point of divergent implementation.

**Rationale:** All seven gaps are grounded in the current code/doc contracts (`machine-config-loader.ts`, `agent-model-config.ts`/`.md`, `workflow-runner.ts`/`.md`) and each names a concrete alternative a competent implementer could otherwise choose — satisfying the ledger's "load-bearing decision" bar. None require narrative expansion; each should land as one ledger entry (decision + one-line rationale where non-obvious) plus, where noted, a corresponding acceptance criterion or documentation-updates target.