**Verdict: two required refinements; three optional polish items; rest resolved or out of scope.**

**Required (bounding gaps — spec guidance requires acceptance criteria to fully pin implementer behavior, not leave forks):**

1. **Resolve the unresolved "or" for `runs single step to completion`.** The Decisions text currently offers two divergent outcomes ("keep only the unique assertion, or drop the test entirely") with no AC distinguishing which happens. Fix by either: (a) committing to one outcome in the Decisions text, or (b) explicitly marking it a deferred implementer judgment call and adding an AC that verifies whichever branch is taken (e.g., the run-id-matches-actual-run assertion survives somewhere in the file, or is confirmed redundant and the PR body says so). Leaving both branches open with no AC discriminating them fails the spec's own bar for bounded acceptance criteria.

2. **Preserve or explicitly retire the "before durable state change" invariant when collapsing the role-validation trio.** One of the three tests being collapsed (`rejects a role absent from loaded config as aggregated per-agent misses before durable state change`) asserts a no-mutation-on-failure invariant that "one table-driven test asserting the aggregated error message per case" does not obviously cover. The spec must state whether the collapsed table also asserts no state mutation on failure (e.g., a shared assertion outside the per-row loop), or explicitly declare that invariant redundant with another named test. Silently dropping it during collapse would be an unauthorized coverage loss, which the intent's "no unique behavior dropped" constraint forbids.

**Recommended polish (small, low-risk, worth folding in during refinement but not blocking):**

3. Add one line acknowledging that dropping the shared-invocation quota-fallback re-proof does not remove shared-invocation/resolver wiring coverage generally — that coverage lives in `implement-workflow-steps.test.ts` and step-runner tests — so the drop reads as removing a redundant re-proof, not an integration-point gap.

4. Sketch the minimal column shape for the collapsed role-validation table (e.g., role, agent-role bindings per step, expected aggregated error) so the "earlier agent has role, later fallback doesn't" scenario is clearly representable alongside the other two cases.

5. Add one clause to the Documentation updates section explicitly stating no `v2/docs/v1-behaviors.md` update is needed because no runtime/operator behavior changes — preempts reviewer pushback per spec guidance's blanket documentation rule.

**Not required:** claims about verifying subsumption correctness at spec-review time (that's implementer/reviewer work, already anchored by the intent's PR-body diff-and-mapping requirement), freezing a baseline test count in the spec (the intent already routes this to the PR body), and speculating about fixture partial-conversion fallback behavior (the "every call site" AC already forces the implementer to handle or flag any oddball site).