Reviewing the implementation and spec against the verdict-plan refinements before issuing the verdict.
Checking how `@mutate` matching works and whether the guard pin string matches the source.
## Verdict

1. **Repair the AC #4 guard pin so it targets text that exists in production.**  
   The pinning test’s `// @mutate` original is a single-line `resolveLinkedDirectives(...)` call, but the live call site is multiline. `@mutate` requires an exact, uniquely occurring substring; this pin will hit `target_absent` at the implement boundary and cannot guard full-block resolution.  
   **Outcome:** The guard pin’s original→replacement pair must match text that occurs exactly once in `mutation-checkpoint-verifier.ts` and, when applied, reverts full-block inputs to first-line-only behavior so `wrapped pinning-test reference on continuation line resolves and catches` fails (pin goes red). Prior trust-cluster pins use in-file snippets (e.g. `resolvePinningTestPath(worktreeRoot, block)`), not collapsed call forms that are not present in source.

2. **Align the subspec AC #4 quoted `@mutate` strings with the landed guard pin.**  
   The ticked AC still quotes a four-argument `resolveLinkedDirectives` call; production uses separate `block` and `criterionText` parameters. The test comment already reflects the five-argument shape, but the AC prose does not.  
   **Outcome:** AC #4 must quote the exact original→replacement pair that the pinning test carries after outcome #1, so the mutation-checkpoint contract is mechanically satisfiable and matches implement-boundary behavior.

**No other actuator work required.** Core fix (`{ criterion, block }` at filter time; `block` for resolution/linking; `criterion.text` for diagnostics), wrapped regressions, doc updates per AC, and trust-cluster negative proof via guard pin (not in-unit negative assertions) are sound. Optional doc polish (`v1-behaviors.md` selection wording, `spec-guidance.md` selection-on-full-block, `intent.md` prerequisites) is outside this spec’s acceptance criteria.