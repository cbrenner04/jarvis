## Verdict: refinements required

### Upheld — must fix

**1. Eliminate the duplicated global preamble in the implementation prompt.**
`prompts/patch/instructions.md` now hardcodes the documentation/naming/terse guidance inline (the block beginning "Before editing code…" through "…omitting required docs"). But the prompt assembler already auto-prepends those same three `global.*` fragments to every `patch.prompt.body` render. The result is that the entire ~11-line global block appears **twice**, back-to-back, in the assembled prompt — and the committed `@r4` rendered fixtures bake this duplication in, so the snapshot test passes green over the defect (it only asserts `revision === "4"`).

This is a direct regression against this spec's stated purpose — prompt slimming and cutting wasted tokens (intent.md). Required outcome: the assembled implementation prompt must contain the global guidance exactly once. The step body should begin at `Read the spec at <SPEC_PATH>.` with the inline global copies removed, and the `@r4` rendered fixtures regenerated so they reflect a single, non-duplicated preamble. The shared and wrapper `patch.prompt.body@r4` fixtures and any review fixtures carrying the same doubled block must be regenerated to match.

**2. Sort changed paths by true lexicographic (codepoint) order.**
Decision 1 of `01-review-shrink-diff-bounds.md` specifies changed paths "sorted lexicographically." The implementation uses `localeCompare`, which is locale-sensitive and not guaranteed to match byte/codepoint ordering. Required outcome: the `getBranchDiffSummary` changed-path listing is sorted by deterministic lexicographic order matching the written contract. Low practical risk, but it is a contract-correctness fix with no downside.

### Surface to operator — do not silently rewire

**3. Direct non-index spec path is unreachable under the real CLI.**
AC #3 of `00` and its supporting code add a branch that injects an operator-passed subspec path as the active subspec when the spec is not `index.md`. However, the run preflight intercepts every non-`index.md` spec before the iteration loop and only permits switching to `./index.md` or exiting — so the new branch never executes end-to-end and is covered only by `buildPrompt` unit tests. This is a spec/preflight inconsistency, not a code bug: the code satisfies the written decision, but the decision assumed a reachable path the preflight forbids. The actuator must not resolve this by rewiring preflight or deleting the AC on its own judgment; flag it for the operator to reconcile (permit direct subspec runs, or drop the dead branch and its AC). Note the latent concern that, if that branch ever became reachable, the per-subspec blocker check and AC-snapshot gate would newly apply to a directly-passed spec — an unmentioned behavior change.

### Not required

`readRepoGuidance` join simplification and `stripOptionalPromptSection` header-literal coupling are cosmetic; the coupling is correct today and the omission paths are unit-tested. No action required.

### Rationale

Finding 1 defeats the subspec's own acceptance intent (slimmer prompts) and is concealed by fixtures asserting only the revision number — exactly the snapshot-governance gap the spec's prompt-revision discipline exists to prevent. Finding 2 aligns observable output with a written decision at zero cost. Finding 3 is a genuine gap but requires an operator decision the actuator cannot make unilaterally.