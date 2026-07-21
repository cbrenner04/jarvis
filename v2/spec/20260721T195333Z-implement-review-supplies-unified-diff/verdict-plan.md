## Verdict: refinements required before merge

### 1. Resolve shared debate-template prose vs. dual v1/v2 payloads (blocking)

`patch.prompt.review.{adversary,advocate,adjudicator}` are rendered by v1 `buildReviewPrompt` with summary-only `getBranchDiffSummary()`, while v2 implement review will inject unified diff via `branchDiff()`. `patch.prompt.review.critic` is v2-only.

AC3 requires all four wired templates to describe merge-base unified diff and drop “not a unified diff.” AC4 only pins v1 runtime behavior (`review.test.ts`); it does not guard template honesty. Implementing AC3 as written makes debate templates claim unified diff while v1 still supplies stat/paths only — contradicting `v1-behaviors.md` lines 106 and 109.

**Required outcome:** The spec must choose and document one coherent stance:

- **Defer debate template prose** to a future slice that changes v1 payload or forks templates (explicitly ruled out today), and narrow AC3/tasks/decisions accordingly; or
- **Limit prose updates to critic** (v2-only file), with an explicit decision that debate templates remain summary-worded until v1 changes — acknowledging v2 debate renders will carry unified diff under summary-only prose until then; or
- **Update all four templates** and explicitly accept that v1 debate prompts will be inaccurate about payload shape while v1 runtime bullets stay authoritative.

The spec cannot leave AC3, scope decisions (“all four wired templates”), and v1 exclusion in conflict. Pick one path and align decisions, tasks, and acceptance criteria.

### 2. Reconcile intent with subspec on `v1-behaviors.md` (required)

`intent.md` says documentation “replaces summary-only bullets”; the subspec correctly requires an additive **[v2 additive]** bullet and forbids editing existing v1 patch-review bullets (lines 106/109).

**Required outcome:** Reconcile `intent.md` to the additive-only pattern so intent and subspec do not contradict each other.

### 3. Tie revision bumps to the snapshot harness when debate templates change (required if debate prose bumps)

The decision already requires regenerating `v1/test/fixtures/prompts/rendered/` on revision bump. Only adversary has keyed snapshot fixtures today (`rendered-snapshots.test.ts` hardcodes revision `"2"`).

**Required outcome:** If debate template revisions bump, add an acceptance criterion (or preservation citation) that `v1/test/prompts/rendered-snapshots.test.ts` stays green — covering fixture regeneration and revision assertions. If the resolution in (1) limits bumps to critic-only, state that explicitly so snapshot work is scoped correctly.

### 4. Assert non-`main` `baseBranch` in the new test contract (required)

`ReviewDebateRenderContext.baseBranch` exists and feeds merge-base resolution. The failing-test AC names `review-implement.test.ts` but does not require verifying a non-default base ref.

**Required outcome:** Extend the test contract so rendered `BRANCH_DIFF` is verified against a non-`main` base branch, not only default wiring.

### 5. Documentation tasks must cover stale references and post-change parity notes (required)

AC5 updates payload wording in `workflow-runner.md` but not the stale source path (`review-debate-render.ts` vs. `shared/prompts/review-implement.ts`).

Line 605 in `v1-behaviors.md` documents v2 async parity as stat + name-only for patch-review branch-diff rendering; after this slice, implement-review payload semantics diverge from that bullet.

**Required outcome:** Doc acceptance criteria/tasks must require fixing the stale `workflow-runner.md` path and either qualifying line 605 or adding a sibling note under the new **[v2 additive]** implement-review bullet so parity readers are not misled.

### 6. Optional but worthwhile clarifications (non-blocking)

- **Prerequisites:** Add a one-line cross-reference to `implement-review-bounds-diff-payload` (merge-first sibling on the same `branchDiff` seam) in the empty Prerequisites section.
- **Path ordering:** Pin changed-path sort order to match v1 `getBranchDiffSummary` (byte/codepoint lexicographic) if orientation parity with v1 matters; current helper uses locale-sensitive `.sort()`.
- **Section heading:** When unified hunks are present, orientation heading/prose should not imply summary-only (fold into whichever template scope (1) selects).

### Rationale

Items 1–2 block merge because they encode contradictory contracts across shared artifacts, the behavior catalog, and intent. Items 3–5 close verifiable gaps the spec already implies (snapshot harness, `baseBranch` wiring, doc accuracy) without expanding runtime scope beyond v2 `branchDiff`. Unbounded diff size remains defensible via the bounds sibling; a Prerequisites cross-reference is orientation only.
