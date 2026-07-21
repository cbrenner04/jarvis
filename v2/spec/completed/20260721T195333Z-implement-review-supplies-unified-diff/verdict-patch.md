## Verdict: refinements required before merge

### 1. Non-`main` `baseBranch` test must prove distinct merge-base resolution (blocking)

AC2 requires rendered `BRANCH_DIFF` against a non-`main` `baseBranch` with merge-base resolved via `ReviewDebateRenderContext.baseBranch`. The fixture branches `develop` from the same commit as `main`, so `merge-base(develop, HEAD)` equals `merge-base(main, HEAD)`. The test exercises the parameter but would still pass if `baseBranch` were ignored and `"main"` used.

**Required outcome:** The test fixture must diverge `develop` and `main` (or otherwise produce a different merge-base for the chosen `baseBranch` than for `main`), and assertions must confirm the rendered diff reflects that non-default base—not merely that `baseBranch: "develop"` is accepted.

**Rationale:** AC2 was marked satisfied prematurely; without real divergence the contract is unenforced.

---

### 2. `v1-behaviors.md` additive bullet must cite real sources (blocking)

AC6 requires an additive **[v2 additive]** bullet noting implement-review payload divergence from line 605, without rewriting v1 patch-review bullets at lines 106/109. Line 606 satisfies the divergence note but cites `review-debate-render.ts`, which does not exist. Line 605 carries the same phantom path.

**Required outcome:** The new implement-review bullet must reference actual code paths (`shared/prompts/review-implement.ts` for v2 implement review; `v1/src/modes/patch/prompt.ts` for v1 patch-review summary rendering). The divergence note must remain clear that line 605 describes v1 patch review and general v2 async parity (stat/name-only), while implement review now carries unified diff.

**Rationale:** AC6 doc accuracy; phantom citations undermine the parity catalog the bullet is meant to clarify.

---

### 3. Reconcile `intent.md` with the landed subspec (required metadata alignment)

`intent.md` still states all four wired templates must describe unified diff with revision bumps, and that `v1-behaviors.md` documentation "replaces summary-only bullets." The reconciled subspec chose critic-only template prose, unchanged debate templates, and additive-only `v1-behaviors.md` edits.

**Required outcome:** Update `intent.md` decisions and documentation sections to match the subspec: critic-only prose/revision bump; debate templates remain summary-worded until v1 changes; `v1-behaviors.md` gets an additive bullet, not replacement of v1 bullets.

**Rationale:** Prevents future readers from reopening the debate-template conflict already resolved in the subspec.

---

### Accepted as in-scope debt (no actuator action)

- **v2 debate roles under summary-only template prose:** Explicit subspec tradeoff until v1 `getBranchDiffSummary` changes or templates fork.
- **Unbounded unified diff:** Deferred to merge-first sibling `implement-review-bounds-diff-payload`.
- **Per-role `branchDiff` recomputation:** Pre-existing pattern; optimization is out of scope.
- **Narrow `@@` assertion / untested path ordering / thin orientation coverage:** Minor gaps against a text-heavy use case; not AC violations.

---

### Summary

Core `branchDiff` implementation, critic template update, shared-helper usage across all four roles, and `workflow-runner.md` corrections align with the reconciled subspec. Three items block or must precede merge: a real non-`main` merge-base test (AC2), accurate `v1-behaviors.md` citations (AC6), and `intent.md` alignment with subspec decisions.
