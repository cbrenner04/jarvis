## Verdict — Required Refinements

**1. Single-step outcome mapping (subspec 01).** Subspec 01's task checklist requires dispatch to work today, so it cannot leave `WorkflowResult.kind`/`resumable` entirely to a future consumer. Add a decision stating the baseline mapping for a workflow containing only a `review-debate` step (e.g., success = all cycles completed without an unhandled throw; `resumable: false`, consistent with the separately-deferred durable-resume work). Multi-step composition semantics may remain deferred.

**2. Role-invocation failure handling (subspec 00).** `executeWithQuotaFallback` can throw when all rungs are exhausted. The spec must state whether such a throw aborts the current cycle, aborts the whole executor, or is caught/recorded — for each of the four roles. This is a direct, immediate consequence of the chosen invocation mechanism (not a hypothetical), so it needs a decision line and a corresponding task/AC, not a deferral.

**3. Agents/bindings schema inconsistency (subspecs 00 and 01).** Subspec 00 describes per-role invocation bindings; subspec 01 describes a single step-level `agents` order applied uniformly to all four roles for role-preflight. Reconcile these into one consistent shape (per-role bindings is the more precise fit, since 00 is the lower-level contract 01 must dispatch into) and align 01's language and validation description accordingly.

**4. Missing interaction test.** Add an explicit acceptance criterion covering the combined case: `maxCycles > 1` where an early cycle's verdict is empty — confirming the loop stops at that cycle rather than continuing, and that this correctly composes with the `maxCycles` bound. This is the most likely place for an off-by-one defect and should not rely on the two behaviors being tested only in isolation.

**5. Telemetry cardinality wording (subspec 00).** Reword the telemetry AC to be precise about quota-fallback rungs: emission is one record per invocation *attempt*, so a single role invocation with N quota-fallback rungs can emit up to N records — not exactly one record per role. Align this wording with however `telemetry-capture.md`/write-step behavior already documents rung-level cardinality (cite it rather than re-deriving it).

**6. Read-only enforcement — make the AC checkable.** "No write-target mutation" as currently worded is not verifiable by any test. State plainly (as a decision) that read-only enforcement in this slice is a binding-contract convention, not sandboxing, and reword the AC to something a test can actually assert — e.g., that adversary/advocate/adjudicator bindings carry no write capability in their type signature — rather than asserting unfalsifiable runtime behavior.

**7. `maxCycles` input range.** Add a one-line decision on whether `0` or negative values are valid (e.g., treated as zero cycles executed, or rejected) — cheap to state, currently unspecified.

**8. "Settled output" clarity.** Clarify in subspec 00 that the verdict text written to `verdictPath` is the adjudicator's raw invocation output with no parsing or normalization in this slice.

**9. Documentation updates (subspec 00).** "None" is insufficient — this slice introduces new operator-facing semantics (default cycle bound, skip-actuator-on-empty-verdict, verdict-overwrite-per-cycle) that aren't yet documented anywhere. Add a documentation update describing this cycle/verdict lifecycle (new or existing doc, wherever the equivalent write-loop semantics live).

**10. Minor clarifications, low cost, should be included:**
   - State explicitly that the caller is responsible for supplying distinct `verdictPath` values across concurrently-running steps (consistent with the existing decision that the executor doesn't derive or dedupe paths).
   - Clarify in subspec 01 that this slice enables only programmatic/runtime construction of a `review-debate` step, not YAML/config-file authoring (already implied by the intent's prerequisites, but worth stating to avoid an operator expecting end-to-end config support).

No other adversary concerns require refinement beyond the above.