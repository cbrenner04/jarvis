Reviewing the implementation and spec artifacts to issue a self-contained verdict.
## Verdict: required outcomes

### 1. Sync `intent.md` to the landed subspec

`intent.md` still uses stale vocabulary (`isUnrealizableReview`), a broader problem statement, pre-fix acceptance wording, and unchecked boxes. It must match the completed subspec: narrowed admission-vs-CLI-parse scope, `isUnrealizableWorkflowReview` as the canonical helper, reframed acceptance criteria, and checked completion state.

**Rationale:** Verdict-plan refinements 1–4 required this before merge. Subspec and code already agree; leaving `intent.md` contradictory creates spec-tree drift.

---

### 2. Make `implement` + `none` a real assertion in the nine-cell loop

The loop-generated case for `implement` + `none` currently returns with no assertion, so it always passes without exercising any contract. That cell must explicitly assert pipeline unrealizability (and remain structurally excluded from CLI argv construction).

**Rationale:** AC2 requires every cell in the `describe` block to enforce the contract — eight realizable cells parse under mapped flags; `implement` + `none` is unrealizable with no CLI argv. A silent early return satisfies structure only; the test name claims parity checking but performs none.

---

### 3. Replace the weak AC3 invert guard with load-bearing enforcement

The standalone “invert” test only restates the helper’s constant truth (`implement` + `none` → true). It does not follow the repo invert convention (inverted boolean on the guarded outcome, as in `pipeline-registry.test.ts`), does not fail if the alignment loop body is removed, and cannot prove the loop guards realizable cells.

Required outcomes:

- An invert guard on the **realizable-cell** parse-success path that fails when the success expectation is negated — this is what makes the eight-cell alignment loop load-bearing.
- The `implement` + `none` unrealizability assertion (outcome 2) must be invertible and fail when negated, satisfying AC3’s letter without mislabeling it as loop-load-bearing for all nine cells.

**Rationale:** Completed AC1 ties AC3 to proving enforcement is load-bearing; AC3 requires inverting the `implement` + `none` assertion to fail. Current code satisfies neither intent honestly. The subspec’s structural exclusion for `implement` + `none` means loop-load-bearing proof must come from the eight realizable cells; admission regressions for that cell remain AC4’s job (`pipeline-definition-validation.test.ts`).

---

### 4. Do not expand scope beyond the subspec

No changes required for:

- Calling `validatePipelineDefinition` inside the alignment test (AC4 pins admission wiring).
- Duplicated posture enumeration or untyped helper parameters (style nits).
- Bidirectional CLI-vs-pipeline checks for `implement` + `none` (explicitly out of band per subspec decisions).
- Re-litigating unrealizable-matrix membership (upstream validation owns it).
- Operator/resolver/preset-table parity (out of scope).

**Rationale:** Core helper extraction, validation routing, mapped argv fixtures, and eight-cell parser cross-check match the narrowed contract. Fixes above close test-enforcement and spec-tree gaps without reopening scope.

---

### Summary

Land helper extraction and the eight-cell CLI cross-check as-is. Before close: sync `intent.md`; assert `implement` + `none` unrealizability inside the loop; add a repo-conventional invert guard on realizable-cell parse success so alignment enforcement is demonstrably load-bearing.