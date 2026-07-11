- Define `maxCycles` as a finite non-negative integer, including invalid-input handling. Remove any unsupported “default 1” claim unless a real defaulting boundary exists; this prevents fractional, `NaN`, and infinite-cycle ambiguity.

- Make the critic’s read-only guarantee accurate and enforceable. Either specify the capability boundary that prevents writes or state that read-only operation is a caller obligation; ordinary invocation bindings alone do not establish it.

- Complete the compatibility migration caused by making `critic` mandatory: update and test all committed machine profiles and document the intentional global validation requirement. This preserves loadability while retaining the intent’s explicit eager-validation choice.

- Update both durable role homes: `v2/docs/role-resolution.md` for taxonomy/mapping and `v2/docs/agent-model-config.md` for schema, validation, and consumption. The documentation standard requires one canonical home per contract without contradictions.

- Pin critic rung consumption, including same-agent quota behavior. It must not implicitly inherit either full-list analysis-role behavior or actuator head-only behavior.

- Define review step identity and lifecycle reporting: run ID creation, `onStepRunCreated` behavior, inclusion in workflow snapshots, and snapshot matching/reuse boundaries. Programmatic non-resumability does not remove observable workflow reporting contracts.

- Define verdict-file failure semantics and workflow mapping. File-write failure cannot remain outside the declared `complete`/`invocation_failure` outcome contract without an explicit thrown-error boundary.

- Specify that the actuator receives the non-empty verdict as its entire prompt, with no separate caller-supplied actuator prompt unless a composition contract is intentionally added. This is required by the intent’s “verbatim” handoff.

- Define cycle accounting precisely. Count a cycle once critic execution begins and a cycle-result entry is recorded, including critic- or actuator-failed cycles; align executor results and `WorkflowResult.iterationsConsumed`.

- Pin abort behavior for critic and actuator invocations, including whether an already-written verdict remains after actuator abort and how abort maps into executor and workflow outcomes.

- Define stale-verdict handling when the critic fails before writing. The contract must explicitly preserve, clear, or invalidate pre-existing content so consumers cannot mistake an earlier verdict for current output.

- Retain the intentionally non-durable, restart-from-zero review contract while clarifying how review steps appear in durable workflow snapshots versus durable run lookup. This distinction is observable to daemon/TUI consumers and costly to reverse.

- Keep each refinement in the subspec that owns the behavior and add co-located coverage for the resulting contracts. Split further if identity/snapshot integration cannot remain independently reviewable with workflow dispatch.
