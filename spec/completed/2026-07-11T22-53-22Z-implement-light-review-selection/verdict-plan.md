## Verdict — refine (7 items)

### 00 — Govern the patch light-review critic prompt

1. **Account for the already-registered `patch.prompt.review`.** A governed patch review prompt with the same placeholder set already exists in the registry and currently has no consumer. The subspec reads as if the critic prompt is net-new. Add a ledger entry that states the fate of the existing artifact (wire it, or add `.critic` alongside it) and, if adding a sibling, why the existing prompt cannot serve — it is a critique-and-refactor prompt for a *writing* agent, which contradicts the read-only critic contract. Rules-out clause required; this is exactly the kind of choice a competent implementer would plausibly get wrong.

2. **Align the placeholder set with what the critic actually renders.** The acceptance criteria list `SPEC_PATH`, `SPEC_TREE`, `BRANCH_DIFF`, `REVIEW_PASS_CONTEXT`, but subspec 01 requires the critic to render the current pass number. Include `REVIEW_PASS_NUMBER` (or drop the per-cycle pass-number requirement in 01) so the two subspecs describe one prompt.

### 01 — Execute a light patch review

3. **Specify the light actuator's prompt.** The subspec says only "the actuator applies a non-empty verdict" and takes no position on what prompt the actuator receives. The existing shared review cycle, absent an explicit renderer, sends the raw verdict text as the entire prompt — no repo guidance, no patch rules. Plan review and debate review both render a real actuator prompt. Add a decision fixing what the light actuator is prompted with, and an acceptance criterion that observes it.

4. **Rewrite the executor decision.** The current line rules out a patch-specific executor by fiat. The established precedent in this codebase is a *context-specific* executor (plan review has its own cycle function; the shared cycle serves the intent path). Whichever route the spec picks — patch-local executor, or an additive optional per-cycle renderer on the shared cycle — the ledger entry must justify it and name the blast radius honestly (the shared cycle's only other consumer). Do not leave "rules out a patch-specific executor" standing unargued.

5. **Pin read-only enforcement for the patch critic.** The plan critic is *enforced* read-only: writes are detected and the working tree is restored, failing the role. The spec asserts the patch critic "does not write" but never says whether that guard applies. On an implement worktree holding real uncommitted work, restore-on-violation is destructive. This must be an explicit decision, not an inference.

6. **The mutual-exclusion rule misses a context.** Review-step dispatch branches on a deferred-intent output *before* plan context; that is a third mutually exclusive shape, not two. Extend the exclusion decision and the dispatch description to cover all three.

### 02 — Select the review behavior

7. **Resolve the flag-vs-config error inconsistency.** The decision cites malformed `reviewPasses` as the single precedent for both failure paths, but a malformed *flag* prints usage while a malformed *config value* returns a named error. The acceptance criterion demands a named error for both. Say which behavior each path gets.

### 03 — Retain the resolved review behavior

8. **The stated mechanism cannot produce the required behavior.** `reviewPasses` on list rows is *derived from the emitted review step*, not carried as an independent snapshot field — which is why it reports zero when no review step exists. `reviewBehavior` is required on review-free implement launches, where no review step exists to derive from, so "mirroring `reviewPasses`" is not a mechanism. Replace it with a real threading decision (an explicit snapshot input field, or carrying the resolved behavior on a step that always exists) that demonstrably works at zero passes.

### Not upheld

- Subspec 01 is correctly sized. Its two halves (patch-context review step; eligibility + pass derivation) key off a type the first half introduces and are not independently testable. Keep it whole.
- The doc-update targets in 00 (`v1/docs/prompt-governance.md` + `v2/docs/prompts.md`) match the precedent set by the plan critic prompt. Leave them.
- No acceptance criterion is needed for `--review-behavior` on non-implement presets; strict per-preset arg parsing already rejects unknown flags.