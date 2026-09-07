Verifying the advocate's key claims against the implementation before issuing a verdict.
## Verdict

**Required before merge**

1. **Parallel scope: timeout must not beat a caught failure.** `runDiffDerivedScopedTests` throws on the first `ETIMEDOUT` before honoring the existing contract that a mutant is caught when any scoped member fails. With co-located exact-stem plus sibling tests (parallel by design), one failing test plus one timing out is misclassified as `non-terminating-mutation` and settles `non_terminating_mutation_failed` instead of continuing as caught. That contradicts `write-behavior.md` and misroutes operator recovery. Fix aggregation so a non-timeout rejection wins over timeout; add an end-to-end regression (not only the current throw-path unit test).

2. **Prompt observer timeout vs docs.** Observer runs are now bounded via `runDiffDerivedScopedTests`, but `verifyPromptRenderCoverage` does not catch `ETIMEDOUT`; a wedged observer propagates as an uncaught throw from `verifyDiffDerivedMutations`, not `non-terminating-mutation` / `non_terminating_mutation_failed`. Subspec 04 docs in `write-behavior.md` and `operator-runbook.md` state unified per-scoped-test settlement. Align implementation and durable docs in this branch — either classify observer timeouts into the documented settlement path or narrow the docs to code-candidate settlement only.

**No actuator action**

- Review-row vs write-row resume wording: imprecise but matches pre-existing `surviving_mutation_failed` / `ready_gate_failed` finalization ownership; tighten in a cross-cutting doc pass, not a logic defect here.
- Review admission without `resumable` gate, cosmetic resolver reject string, sidecar orphan on failed mutate `writeFile`, restore `writeFile` I/O failure, loose while-true wall-clock slack, missing orphan-process assertions, unchecked `intent.md`: acknowledged gaps or pre-existing patterns; outside completed subspec ACs and not blocking this slice.