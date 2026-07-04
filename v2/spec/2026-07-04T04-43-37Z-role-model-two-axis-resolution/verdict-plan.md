1. Require one observable acceptance criterion that the live workflow step path consumes resolver-produced flat bindings, not just resolver-local tests. The intent is to resolve a step role into the binding list `shared/invocation/execute.ts` consumes; without a production-call-site outcome, the subspec can pass with an unused helper.

2. Decide the resolver boundary’s role contract explicitly, including `operator`. The spec currently requires a closed role contract and bans category lookup, but it does not say whether this boundary accepts the full documented role union and rejects non-executable roles here, or only an executable subset. That ambiguity is observable and costly to reverse.

3. Add executable coverage that full-list consumption applies across the non-`actuator` roles named in scope, not only `implement`. The decisions enumerate `plan`, `implement`, `adversary`, `advocate`, and `adjudicator`; the acceptance criteria should prove that contract rather than infer it from prose.

4. Tighten the quota-only fallback guard to an executable outcome on the resolver path or shared-execution path, not a source-anchor allowance. The intent makes `quota` the only advance signal and makes `model_config` and `error` terminal; for a behavior-changing harness subspec, spec guidance favors observable verification over structural description.

5. Clarify the empty-`agents` outcome. The resolver input contract should state whether no configured outer agents yields an empty binding list that shared invocation treats as “no bindings configured.” This is a small edge case, but it is part of the observable resolution contract and should not be left implicit.
