# Verdict: Required refinements

## 1. Acceptance criteria must cover all default-resolution paths

The decisions enumerate every site that currently falls back to zero passes (`resolveImplementLaunch` early returns including `projectRoot` and missing `configPath`, `readProjectImplementReviewPasses` absent-field, and builder post-launch fallback). The acceptance criteria only partially match that enumeration.

**Required outcome:** Add verifiable criteria so an implementer cannot ship `1` on the registered-launch path while leaving `projectRoot` or other early-return paths at `0`. At minimum, cover the `projectRoot` path with an omitted-flag default (no CLI `reviewPasses`, no project override) that expects one debate review step. Either name a dedicated failing-test AC for that path or state explicitly that the primary new-behavior test exercises it.

**Rationale:** Spec guidance requires failing-test ACs for runtime behavior changes; a single builder test on the registered path does not prove multi-site fixes.

---

## 2. Anchor the opt-out preservation criterion to an existing test

The spec requires `--review-passes 0` to still produce a one-step workflow with no review step. That behavior is already pinned by an existing test.

**Required outcome:** Rewrite that acceptance criterion as a preservation AC citing `implement-workflow-steps.test.ts` `"reviewPasses 0 returns a one-step implement workflow with no review step"` stays green.

**Rationale:** Spec guidance for behavior-preserving ACs: cite the pinning test instead of paraphrasing.

---

## 3. Add criteria for registered-path and explicit-config edge cases

Two gaps remain relative to the decisions (“overrides when set”; absent field defaults to `1`):

| Gap | Required outcome |
|-----|------------------|
| Registered project, no `implement.reviewPasses`, omitted CLI flag | AC: two-step workflow with one `review-debate` step (or equivalent observable outcome). |
| Registered project with explicit `implement.reviewPasses: 0`, omitted CLI flag | AC: one-step workflow with no review step. |

**Rationale:** “When set” includes explicit `0`, which is distinct from absent → `1`. Positive override (`reviewPasses: 2`) is covered elsewhere; absent-field default on the registered path should be explicit in ACs, not implied.

---

## 4. Pin debate semantics in the new default-behavior criterion

The new default-behavior AC should require `review-debate` behavior (step id, behavior field, or citation of the existing positive-passes test pattern), not merely “one review step.”

**Rationale:** Intent keeps `reviewBehavior` default `debate`; pass count alone does not prevent a wrong review mode from satisfying a thin AC.

---

## 5. Expand documentation acceptance scope

Three docs are listed, but other committed docs still describe implement review default `0` (e.g. `install-and-config.md`, `write-behavior.md`, `first-workflow-walkthrough.md`, and the v1-behaviors overview). `workflow-runner.md` also needs the omitted-flag default stated, not only `0` vs positive behavior.

**Required outcome:** Broaden the documentation AC to require all committed docs that state implement review default `0` to reflect review-on-by-default (one debate pass) and `--review-passes 0` opt-out—or enumerate the full set of files.

**Rationale:** Partial doc updates will rot operator-facing truth; harness behavior changes that alter defaults must update the v1 parity catalog and related onboarding/config docs per spec guidance.

---

## 6. Strengthen the task checklist for collateral test and fixture updates

“Update tests that pin the old zero-pass default” is implementer guidance without verification hooks.

**Required outcome:** The task checklist must name collateral updates, including at least:
- `machine-config-loader.test.ts` absent-field expectation (`reviewPasses: 1`)
- `implement-workflow-steps.test.ts` fixtures such as `INPUT` / `INPUT_WITH_ARTIFACT` (explicit opt-out, not implicit default)
- `workflow-runner.test.ts` snapshot/metadata expectations that encode zero as the implicit default
- Builder post-launch fallback (`resolvedInput.reviewPasses ?? 0` → `?? 1`)
- Note that the existing one-step happy-path test using explicit `reviewPasses: 0` remains an opt-out fixture; the new test owns the default path

Pair with an explicit note that `bun run test:v2` must pass after changes, or distribute coverage across named ACs.

**Rationale:** Default changes break implicit-zero fixtures; the checklist should prevent incomplete landings without prescribing implementation line numbers as ACs.

---

## 7. Record supersession and operator impact in Decisions

This spec reverses the prior shipped contract (“absent → `0`” from the implement-review-passes work) in favor of v1 parity.

**Required outcome:** Add a Decisions bullet acknowledging supersession of that prior default and that scripts/workflows that omit `--review-passes` will now get one review pass (breaking change for zero-pass-by-omission callers). Optional: note coordination with any sibling intent that touches the same doc narrative to avoid contradictory merges.

**Rationale:** Intent explicitly chooses v1 parity; the spec should document the deliberate reversal and cost/discoverability implications called out in the decisions.

---

## Not required

- Splitting into multiple subspecs (one atomic behavior change is appropriate).
- CLI/daemon end-to-end step-count AC (`workflow.test.ts`); builder resolution remains the contract seam.
- AC for `~/.jarvis/config.json` exclusion (design constraint, not a regression surface).
- Fractional/invalid `reviewPasses` values (out of scope).
