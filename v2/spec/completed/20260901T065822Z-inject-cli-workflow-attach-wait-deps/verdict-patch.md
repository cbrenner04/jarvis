Reviewing the implementation and related docs against the spec to issue a verdict.
## Verdict

No required outcomes.

The patch matches the subspec: module-level attach-wait test lets and exported setters are removed; `forceSkipAttachClientWait` and `attachWaitRunIdOverride` are optional `CliDeps` fields read in `startWorkflowRun` with unchanged production defaults; guard-inversion cases inject overrides per invocation through `main()` deps; listed tests and typecheck/test gates are satisfied.

Tradeoffs called out in review — injectable fields on shared `CliDeps` instead of module globals, deps-based falsification instead of source comment-checkpoint mutation for attach-wait guards, permissive negative assertions, cross-command deps bag placement — are explicit spec decisions or pre-existing patterns, not gaps against acceptance criteria. Optional polish (comment phrasing, `Inversion target:` annotations, tighter negative pins, `intent.md` sync) is out of scope for this subspec and does not block acceptance.