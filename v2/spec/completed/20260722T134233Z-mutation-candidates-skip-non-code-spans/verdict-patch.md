## Verdict — changes required

Three defects must be fixed; the rest are documentation/coverage gaps that follow from them.

### 1. A candidate must never carry masked filler text (blocking — production crash)

Candidates are derived from the masked line but applied to the original file, and the guard deriver's `!(…)` pattern can span a masked region. For a real and common repo pattern like `if (!("minFreeGb" in memory)) {` (e.g. `v2/src/config/machine-profile-loader.ts:23`), the derived `originalText` is `!(             in memory)` — spaces where the string literal was. `applyMutation`'s new column-slice guard then compares that against the file's real text, mismatches, and throws. `testCandidate` wraps it as a bare `Error`, which is not a `SurvivingMutationResult`, so it propagates out of completion as a generic finalization failure.

Required outcome: for every candidate the deriver emits, `applyMutation` succeeds — no candidate's recorded text may contain masking filler that isn't in the source line. Whether that is achieved by slicing the candidate's text from the original line at the masked-derived columns, or by discarding candidates whose span overlaps a masked region, is your call; both are consistent with the spec. Pin it with a test over a line matching `if (!("k" in o))` (or equivalent), and add a test that the column-slice guard's mismatch path throws as designed.

### 2. Single-line block comments are not masked

`maskNonCodeSpans` handles `"`, `'`, `` ` ``, and `//` only. `deriveFromLine`'s early return covers whole-line `//` and `*`-continuation lines, not a self-contained `/** … */` or `/* … */`. Real sites in this repo (`v2/src/commands/cleanup.ts:261`, `v2/src/execution/external-worktree.ts:58`, `v2/src/execution/workflow-runner.ts:195`, `v2/src/persistence/state-store.ts:308`, `shared/git.ts:92`) contain `<branch>`-style placeholders that reproduce exactly the `CLEANUP_USAGE` failure this spec exists to eliminate.

Required outcome: a changed line whose only mutable characters sit inside a single-line block comment yields no candidate, including when the comment is unterminated on that line (mask to end of line, consistent with the existing line-scoped rule). Test it. The spec's line-scoped caveat excuses interior/tail lines of a *multi-line* block comment; it does not excuse a one-liner, and Decision 1 says "comments" without qualification.

### 3. AC 7 and AC 1 are ticked but not satisfied

- AC 7 requires that inverting the escape branch fails at least one test. It does not: negating it makes the lexer over-mask to end of line, and every escape test places the string at end of line and asserts only length / absence of `<` / a prefix — all of which survive the mutant. Add a fixture with a genuine operator *after* an escape-containing string so over-masking is observable.
- AC 1 names `<`, `>`, `!`, and `delete(` inside a string literal; only `<` is covered. Add the missing cases — the `!`-in-string case is precisely where defect 1 lives.

Re-tick both only once the coverage matches the wording.

### 4. Docs must match delivered behavior

`v2/docs/workflow-runner.md` and `v2/docs/v1-behaviors.md` both state that comments are masked. Once block comments are handled, that is true; do not weaken the sentences instead of fixing the code.

Also record the two known coverage limitations alongside the existing line-scoped caveats in `workflow-runner.md`: a regex literal containing a quote character opens a phantom masked span, and template-interpolation interiors (`${…}`) are masked. Both are fail-safe — masking only ever removes candidates, so they cause silent coverage loss, never a false `surviving_mutation_failed` — but a reader needs to know the boundary.

### Not upheld

- The comment-start branch and the quote-open/quote-close branches are adequately covered for AC 7; no additional tests needed there.
- The strict column-slice guard in `applyMutation` is correct and spec-mandated (Decision 5). Do not relax it back toward `String.replace`.
- Nested/desynced backticks and file-scoped multi-line state are explicitly out of scope per the spec's line-scoped decision. Leave them.

### Cosmetic

The magic character offsets in the masking unit tests (`…test.ts:740–742`) are brittle; derive them with `indexOf` so the assertions survive fixture edits.