## Verdict — refinement required

The draft is directionally right (two subspecs, definition + validator, source-owned registry). Four issues are substantive; four more are one-line gaps. All must be addressed in refinement.

### Must fix

**1. `{workflow, review}` has no resolution rule, and the postures the registry uses aren't all executable.**
In v2 today, review is encoded two different ways: for intent/plan it is baked into the *preset name* (`intent`, `intent-reviewed`, `plan`, `plan-reviewed-light`, `plan-reviewed`), while for implement it is a *builder input* (`light` / `debate`, with no opt-out). The draft's stage shape pairs a preset name with an independent posture, so it admits combinations that resolve to nothing — including ones in its own registry. As written, the "every registered definition validates clean" criterion grades nothing, which defeats the intent's whole point.

The spec must pin, as a decision in subspec 00, how `(base workflow, posture)` resolves to an actual preset or builder input — covering every legal cell and naming the cells that have no realization. Only base workflow names may appear as stage values (a reviewed preset name in the `workflow` field is itself an error). Subspec 01 must then carry a rejection code and test for the unrealizable combinations, alongside the three already listed.

**2. `review` must be widened the same way `workflow` is.**
Subspec 00 deliberately types `workflow` as `string` so the validator, not the compiler, is the checker. The `invalid-review-posture` code in 01 is untestable without a cast unless `review` gets the same treatment. Apply the same decision and rationale to both fields.

**3. Duplicate stage IDs and empty stage lists must not be deferred.**
A pipeline of three approval stages sharing one ID currently validates clean. That is exactly the "reject up front rather than three stages in" failure the intent names, and both are single-predicate checks. Add them as named validation errors in subspec 01 with tests. Stage-*ordering* rules remain a correct deferral — keep that one.

**4. The posture→role-binding rule is overclaimed and under-anchored.**
The role *sets* (`light` → critic/actuator; `debate` → adversary/advocate/adjudicator/actuator) do match the workflow loader. The *binding requirement* does not — the loader hands the full agent list to every role and never consults per-role bindings. Correct the "mirrors the loader" claim to cover only the role sets, and anchor the binding rule to the consumer that actually fails on a missing binding (role→model resolution against `AgentModelConfig`), so the rule is falsifiable rather than invented. Two consequences to fold in: state the check as "the role key is present" (empty rungs are already rejected at config load, so "non-empty escalation" is a distinction without a difference), and note that `AgentModelConfig` values are optional — the scan must tolerate `undefined` entries, with a test for a config that binds nothing.

### Should fix — one line each

- **Error-shape divergence.** Lookup failure is pipeline-scoped; validation failure is stage-scoped. That's defensible, but the new pipeline-scoped validation errors (empty list, duplicate ID) force the question. State one rule for how a pipeline-scoped validation error fills the stage field, and that `message` is always present.
- **Implement posture has a competing source of truth** in the per-project implement review behavior read by the machine-config loader. Nothing in this slice consumes posture, so don't decide precedence — but make it an explicit deferral rather than silence.
- **Registry descriptions are inaccurate.** Both definitions drop their terminal stage relative to the brief. Fine under the terminal-action deferral, but say "truncated pending the terminal-action slice" so no reviewer reads `fast` as complete.
- **Missing documentation ACs.** Both subspecs list `v2/docs/workflow-runner.md` under Documentation updates with no acceptance criterion covering it. Docs are part of the work — add one per subspec.
- **`unknown-pipeline` has no operator surface** in this slice. State the deferral explicitly, the way subspec 01 states its own.
- **Validator↔preset-registry coupling.** Checking names against the builder map pulls the whole step-builder graph into the validator. A name-list export preserves the "no second hand-maintained list" decision without the coupling; record it as a decision.

### Trim, don't expand

Subspec 00's guard-inversion criterion should be cut back to the lookup hit/miss branch. A discriminated union has no runtime narrowing guard in a module with no consumer, and dressing one up invites a fake test. Relatedly, 00 is a types-and-registry subspec: its "fails against pre-change code" claim is a compile error, not a behavior surface. Say that plainly and lean on the guidance's exemption rather than overstating.

### Keep

The two-subspec split stands. Subspec 00 is independently testable (registry contents, lookup totality both ways), and separating the definition surface from the validator surface keeps 01's dependency clean. Combined size is not the problem here.