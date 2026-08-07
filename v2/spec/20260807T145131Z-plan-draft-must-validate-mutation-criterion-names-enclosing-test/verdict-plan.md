## Verdict: required refinements

1. **Document residual hollow classes (scope boundary)**  
   Add an explicit decision that plan-draft enclosing-test validation does **not** prove the criterion names the directive’s `pinTitle`—only that criterion text `includes` at least one title that exists in the resolved pinning file. Wrong-but-existing titles and titles from a different test in the same file remain implement-time hollow. Rationale: intent says “aligns with implement-time linking” on the matching primitive, not full linker parity; without this boundary, implementers may over-tighten or reviewers will read “aligns” as complete parity.

2. **Separate “no pinning reference” from “missing pinning file” skip behavior**  
   Clarify that when a mutation-checkpoint-shaped criterion has **no resolvable pinning-file reference** (not just a missing on-disk file), plan-draft **skips** enclosing-test validation and implement still owns refusal. AC #3 must not read as covering the no-reference case, or the spec must decide to hard-reject no-reference criteria (distinct contract). Rationale: silent pass at plan-draft for criteria with no backticked pinning file is a real gap distinct from greenfield missing files; operators need an explicit tradeoff, not an ambiguous skip bucket.

3. **Reconcile intent wording on checked vs unchecked criteria**  
   Intent “ticked/authored” must match the subspec: scan **authored** criteria (checked and unchecked) in staged `NN-*.md` via shared selectors; plan-draft is stricter than implement’s ticked-only gate. Rationale: intent/subspec mismatch will confuse implementers on which criteria are in scope.

4. **Broaden regression coverage for keystone and directive-shaped criteria**  
   Decisions already include `Keystone checkpoint:` and directive-shaped `@mutate` criteria, but ACs lean mutation-checkpoint-only. Add at least one keystone omission rejection regression (and ensure directive-shaped omission is exercised—e.g. criterion with `@mutate` but no `Mutation checkpoint:` prefix). Rationale: selection branches are first-class in the verifier; pass-path-only AC #2 does not prove those shapes are validated.

5. **Specify pin-title extraction outcome, not just “add extraction”**  
   Tasks/decisions must state whether titles are **all resolvable `test()`/`it()` titles in the file** (including multiline `test.each` continuations per #2696) or only titles from directives in that file, and that extraction reuses verifier pin-title scan patterns—no forked regex. Rationale: “all titles in file” is weaker than directive-only and affects false passes; implementers need a single authoritative rule.

6. **Define rejection diagnostics: shape, ordering, and operator projection**  
   - State first-violation-wins vs aggregation when multiple criteria fail.  
   - State whether `failureReason` is free-text (normalizer-style) or structured (`criterion:` / `reference:` / `reason:`), and what substrings operators/tests must see.  
   - Given prerequisite `propagate-plan-draft-normalizer-reason`, decide whether enclosing-test rejections also append staged `intent.md` `## Blocker` and surface through write-loop `contract_miss_detail` projection—or explicitly document weaker `failureReason`-only propagation. Add AC(s) for whichever projection level is chosen. Rationale: AC #1’s `toContain` assertions are insufficient without a decided operator-visible contract; normalizer parity is the documented baseline.

7. **Decide unreadable pinning file behavior**  
   When pinning-file resolution succeeds to a path but the file cannot be read or parsed, state whether plan-draft fails with a diagnostic (normalizer-like) or skips enclosing-test check (like resolution failure). Rationale: advocate flagged this as undecided; silent skip vs hard fail changes operator trust.

8. **Clarify terminal non-fallback behavior (optional but low-cost)**  
   One decision sentence: enclosing-test `contract_miss` is terminal through `composePlanDraftArtifactCheck` (no durable-dir shape fallback), same as other non-`plan.draft.shape` rejections. Rationale: prevents reprompt/fallback ambiguity at the seam.

9. **CI scope when touching `shared/**`**  
   If implementation lifts pinning resolution or title extraction to `shared/`, AC #9 (or tasks) must require the full CI union (`test:v1` + `test:v2` + `test:integration:v2`) per repo scope rules—not `test:v2` alone. Rationale: `shared/**` changes trigger all three suites; AC #9 as written under-specifies verification.

10. **Fix AC #1 baseline wording**  
    Replace “fails against advisory-only plan-review hollow-pin behavior” with language that the regression fails against **pre-fix code with no plan-draft enclosing-test hard rejection** (plan-review hollow-pin stays advisory). Rationale: pre-fix failure mode is plan-draft pass, not plan-review advisory.

**No split required.** Single subspec, single seam (`validatePlanDraft` / `composePlanDraftArtifactCheck`), atomic and independently testable once the above gaps are closed. Mutation-checkpoint guard-inversion AC brittleness and documentation ACs are acceptable as written.