**Verdict**

All seven raised issues are upheld. The spec needs a refinement pass before it's implementable.

1. **Wire-schema gap at `start`/queued rehydration.** The persisted `WriteLoopInput` carries already-built `bindings` plus a display-only `telemetry.role` string — not raw `(agents, role, agentModelConfig)`. The spec must state explicitly where the raw resolution inputs come from at deserialization: either add `role`/`agentModelConfig` fields to the persisted `WriteLoopInput` schema, or name the alternate source. Leaving this implicit forces the implementer to invent a data-shape decision the spec should own.

2. **Scope must exclude ad-hoc (non-workflow-step) writes, explicitly.** `resolveExecutableRole` throws on non-executable roles, and ad-hoc CLI/TUI writes have no role/profile context to resolve from. The "unify every daemon path" language overclaims. The spec should scope binding-resolution unification to workflow-step-driven runs (start, queued promotion, resume) and explicitly state that ad-hoc/direct writes remain on `createAgentBindings` — not attempt to widen resolution to paths that structurally lack the inputs.

3. **Paused-resume scope and ad-hoc fallback.** `role`/`agents`/`agentModelConfig` exist only on `WorkflowSnapshotStep`, but `paused` status is reachable by any write loop, including ad-hoc ones without that snapshot. The spec must scope resume's binding reconstruction to workflow-step-driven paused runs and define the outcome for an ad-hoc paused run (continue rejecting with `not_implemented`, or another explicit behavior) rather than silently assuming all paused runs carry a workflow snapshot.

4. **Queued-input AC is unverifiable until #1 is resolved.** "Same resolved binding chain order" as an immediate-admit run can't be checked without knowing where queued rehydration's raw resolution inputs come from. Fix falls out once the wire-schema decision is made.

5. **Fate of `createAgentBindings` and any ad-hoc CLI callback.** Once ad-hoc writes are explicitly out of scope (#2), `createAgentBindings` stays exported/used for that caller, and the AC claiming "no daemon production path imports it" must be scoped to non-ad-hoc (workflow-step-driven) paths, not literally every path.

6. **AC framing.** Rephrase the first acceptance criterion around observable behavior (e.g., "the agent process runs instead of terminal-erroring") with the symbol-level check (no `normalizeBindings`/`hasLiveBindings`, no ad-hoc-path `createAgentBindings` import) retained as a secondary mechanical guard — consistent with the spec guidance's behavioral-AC framing.

**Required outcomes for the refined spec:**
- Add a decision resolving the wire-schema/data-source question for `start` and queued rehydration (does `WriteLoopInput` gain fields, or is context sourced elsewhere).
- Narrow "unify all daemon binding-resolution paths" to workflow-step-driven paths (start, queued promotion, resume); explicitly defer/exclude ad-hoc CLI/TUI writes, using the "deferred to first consumer" framing where appropriate.
- Add a decision on ad-hoc paused-run resume behavior (explicit fallback, not silently assumed away).
- Scope the "no daemon production path imports `createAgentBindings`" AC to the non-ad-hoc paths actually being unified.
- Rewrite the first AC in behavioral terms per spec guidance's good/bad examples, keeping a structural check as secondary.

These gaps are necessary to close because the current draft's tasks and ACs presume data (raw role/profile at deserialization, workflow-snapshot presence on all paused runs) that doesn't uniformly exist in the code paths described, per the intent's own prerequisite that real bindings are wired and the "deferred to first consumer" principle for unresolved data-source choices.