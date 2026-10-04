Verifying key codebase claims so the verdict is grounded in the actual implementation.
## Verdict: required refinements

### 1. Cross-engine divergence test must respect module boundaries

**Outcome:** The acceptance criterion that proves v1 and v2 review prompts diverge on branch-diff description must be satisfiable without `shared/**` importing `v1/**` or `v2/**`.

**Rationale:** `shared/**` is version-agnostic; a shared test calling v1 `buildReviewPrompt` violates the one-way dependency rule. Intent still requires a pre-split-failing proof that the id split produces divergent prose; the spec must specify an approach that stays within that constraint (e.g. test in `v1/test/` or `v2/test/`, or compare registry artifact bodies in shared without invoking engine render code).

---

### 2. All four v2 roles need explicit prose verification with a pre-split-failing test

**Outcome:** Acceptance criteria must require automated verification that critic, adversary, advocate, and adjudicator v2 artifacts describe `BRANCH_DIFF` as a merge-base unified diff and contain no `not a unified diff` wording — not only the critic. At least one named test must fail against pre-split code for the debate-role prose fix (separate from the id-split divergence test).

**Rationale:** AC2 covers all four roles, but the only existing prose pin is critic-only. Spec guidance requires a failing-test AC for every runtime-behavior change; debate templates still carry summary-only prose today.

---

### 3. Mutation-checkpoint criteria must embed real `@mutate` directives and cover independent pin surfaces

**Outcome:** Any AC that claims guard inversion via mutation must name a test file containing a literal `@mutate` directive with uniquely occurring target text. Coverage must include at least:
- the adversary id constant in `review-implement.ts`
- `implementReviewProfile.promptIds` in `review-profile.ts` (independent of the constants map)

**Rationale:** Harness enforces `@mutate` in the test file, not prose references. Two independent id-pin surfaces exist today; mutating only the constant map would not catch a profile revert.

---

### 4. New artifact copy conventions must be decided and recorded

**Outcome:** Decisions section must specify: heading convention for implement-owned prompts (e.g. `# Implement Mode — Review: …`), which existing template bodies debate roles copy from with critic-style `## Branch diff` substitution, and `revision:` baseline for all four new artifacts.

**Rationale:** “Match critic section pattern” is ambiguous on headings and source material; implementers could ship inconsistent artifacts without a recorded choice.

---

### 5. Post-split governance state must be documented beyond the two named docs

**Outcome:** Documentation updates (at minimum `v2/docs/v1-behaviors.md`, optionally `v1/docs/prompt-governance.md`) must record:
- `patch.prompt.review.critic` becomes frozen and unwired after v2 moves to `implement.prompt.review.critic`
- `patch.prompt.review.*` debate artifacts stay summary-worded while critic already has unified-diff prose (intentional patch-family inconsistency)
- `implementReviewProfile` keeps `patch.prompt.review-actuator` while critic/debate move to `implement.prompt.review.*` (partial split)
- shared API names (`PATCH_REVIEW_*`, `renderPatchReviewCriticPrompt`) stay unchanged this spec; rename deferred

**Rationale:** Intent freezes v1 artifacts but does not forbid documenting orphan/unwired status. Silence creates governance drift and implementer thrash on naming.

---

### 6. Task checklist must name downstream test fallout and all id pin sites

**Outcome:** Task checklist must explicitly call out updating `implementReviewProfile.promptIds` and v2 tests that hardcode `patch.prompt.review.*` for implement review (`implement-workflow-steps.test.ts`, `workflow-runner.test.ts`, `review-debate.test.ts`, `review-cycle.test.ts`, `review-profile.test.ts`).

**Rationale:** Id change ripples through execution/profile tests; omission risks mid-run surprise. Step builders follow constants, but the profile map is a separate pin.

---

### 7. Restore prerequisite for subspec self-containment

**Outcome:** Subspec should include `## Prerequisites` stating v2 implement review already supplies merge-base unified diff as `BRANCH_DIFF` (landed spec `20260721T195333Z-implement-review-supplies-unified-diff`).

**Rationale:** Intent declares this gate; subspec omission weakens regression protection if branch-diff behavior regresses.

---

### 8. Optional but recommended: doc-reference hygiene AC or task

**Outcome:** Either a task bullet or acceptance criterion ensuring v2 implement-review docs (`workflow-runner.md`, `write-behavior.md`) no longer describe `patch.prompt.review.*` as the active v2 id set after the split.

**Rationale:** Stale doc references are a predictable post-split failure mode; low cost to bound in the spec.

---

### Defended without refinement

- `behavior: patch` on implement-owned ids (no implement fragments exist yet)
- Single subspec scope (one module boundary; split would leave tree broken mid-flight)
- Preservation via `v1/test/prompts/rendered-snapshots.test.ts` (correct refactor-AC pattern; critic file immutability is intentional side effect, not v1-tested behavior)
- One adversary role suffices for cross-engine divergence proof of the id split (separate from all-four prose verification in item 2)