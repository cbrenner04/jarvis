## Verdict: Required Refinements

1. **Pin the error-reporting contract.** Decide and state whether load validation is fail-fast (stop at first violation) or aggregates all violations before returning/throwing. This changes the test surface for every acceptance criterion and must be explicit, not left to implementer discretion.

2. **Add basic structural validation as a decision + hard-error rule, not a deferral.** Current decisions jump from "rungs missing/empty" directly to deferred catalog-lookup checks, skipping shape validation that is within scope for returning a "validated `AgentModelConfig`": non-array `rungs`, a rung missing required fields (e.g. `adapterModel`, `priceKey`), or fields of the wrong type. These are cheap, distinct from the deferred catalog-existence checks, and should be a hard-error rule with a matching acceptance criterion.

3. **Add an acceptance criterion for malformed/non-object input.** The Decisions section already states malformed JSON / non-object top-level / non-object per-agent value is a hard load error, but no acceptance criterion exercises it. Add one.

4. **Make the "first consumer" filename pin exercised by real code.** Nothing in the current task list actually reads from `data/agent-model-config.json` — the loader takes a pre-parsed JSON value, so the filename decision is asserted but never exercised. Scope the loader's task to read from the resolved on-disk path (not just accept pre-parsed JSON), giving the filename decision a real code path. This does not require adding a checked-in data fixture — reading-from-path is the missing piece.

5. **Pin behavior for an empty `agents` list.** Add a one-line decision: an empty `agents` list is vacuously valid (no required agents, so nothing to check) and load succeeds trivially. This isn't currently covered by the duplicate-name rule and should be stated to avoid inconsistent implementations.

6. **Pin behavior for unrecognized/typo'd role keys.** State explicitly whether unknown role keys in the data file are silently ignored (consistent with "extra agent ignored" symmetry) or rejected. Either is acceptable, but leaving it implicit risks a confusing "missing role" error masking what is actually an operator typo in a hand-edited global file — a real authoring failure mode worth naming.

7. **Name the loader module location in the documentation-update task.** The doc-update task references "a pointer to the loader module" without deciding where that module lives. Per spec-guidance's harness-subspec carveout (structure-is-the-contract), name the target module path.

**Rationale:** All seven refinements are one-line decisions or a missing acceptance criterion — none require expanding this slice's scope beyond the load contract. Per spec-guidance, decisions must be load-bearing and explicit rather than left for the implementer to guess (this directly affects error-message shape, test surface, and hand-edited-file failure modes), and every stated decision needs a corresponding acceptance criterion so the contract is actually verified, not merely asserted in prose.