# Verdict: required refinements

## Subspec 00 — Step contract check carries dynamic failure reason

1. **Explicit pass/fail discriminant** — Decisions must state that contract failure detection uses an explicit `ok` (or equivalent) field, not JavaScript truthiness on structured check returns. Without this, `{ ok: false, reason: "…" }` would be treated as pass and the subspec’s dynamic-reason AC would not bind implementers to the right behavior.

## Subspec 01 — Plan-draft normalizer message on contract miss

2. **`artifact.exists` as one composed check** — Decisions or tasks must define how staging (`.jarvis-plan-stage` / `expectedArtifactPath`) and durable paths are evaluated once `validatePlanDraft` returns structured outcomes instead of booleans. Required outcomes:
   - One contract check, not two values OR’d (objects are truthy; OR would false-pass or drop messages).
   - Pass if either path validates.
   - When both fail, which `failureReason` wins (staging-first matches current diagnostic bias).
   - When staging fails normalization but durable passes, contract still fails with the staging normalizer message (do not silently pass on durable fallback).

3. **Promotion-path consumer** — After `complete`, `write.ts` still calls `validatePlanDraft` in boolean context for durable→staging promotion. Subspec 01 must require that path keep a boolean success predicate (e.g. `.ok` or a helper), separate from contract `failureReason` propagation, so changing the return shape does not break promotion.

4. **Pin staging in normalizer ACs** — Multi-surface and missing-index-link ACs must name `.jarvis-plan-stage` or “agent writes to `expectedArtifactPath`” so fixtures cannot satisfy propagation only via the durable OR leg.

5. **Zero-subspec shape vs normalization order** — Clarify whether normalization runs when `index.md` exists but there are zero `NN-*.md` subspecs. Outcome: missing-shape cases must settle `plan.draft.shape` without normalizer wording; say whether that is achieved by skipping normalization or by accepting current order.

6. **Optional but low-cost:** One AC that `failedContractId` remains `"artifact.exists"` on plan-draft normalizer misses, to prevent contract-id drift.

## Subspec 02 — Plan-draft contract_miss loop diagnostics and docs

7. **Blocker target path** — Extend the harness-blocker AC to pin where `## Blocker` is appended for `plan.prompt.draft` + `artifact.exists` (e.g. `expectedArtifactPath` under `.jarvis-plan-stage`, same pattern as `spec.criteria-ticked`). Body-only assertion allows appending to a durable path that may not exist on first draft.

8. **Reprompt explicitly out of scope** — Intent or subspec 02 must record that including the normalizer message in the next plan agent reprompt is deferred (not covered by this spec or by `surface-contract-miss-reason-on-run-rows`). The seed implied reprompt; silence reads as intent drift.

9. **Clarify net-new work in 02** — Task checklist or decisions should note harness blocker append is largely pre-wired via `failureReason`; 02’s distinct deliverables are `contract_miss_detail.failureReason`, loop tests, and docs.

## Intent (`intent.md`)

10. **Reprompt deferral** — Mirror the out-of-scope reprompt decision at intent level if not only in subspec 02.

11. **Invert-guard AC mapping** — The intent checkbox “inverting the guard … turns the first two tests RED” spans subspecs 00 and 01. Clarify that mapping (split intent checkboxes or note “covered by subspecs 00 and 01”) so the aggregate checklist is not ambiguous.

## Index

12. **Docs sequencing note** — Index or subspec 02 should state operator-facing docs (`write-behavior.md`, `v1-behaviors.md`) land with subspec 02; do not merge 01 without 02 or an explicit docs follow-up (per spec guidance on `v1-behaviors.md` for behavior changes).

---

**Rationale:** Items 1–5 block a correct implementation: structured returns plus the current `||` chain and truthiness checks would false-pass or discard normalizer text—the core intent. Items 6–7 close real operator-facing gaps (blocker placement, seed reprompt). Items 8–12 reduce ambiguity and review drift without changing scope.

**Not required for refinement:** Representative normalizer fixtures vs full error taxonomy; redundant “without normalizer wording” phrasing; `failureReason` truncation (defer until list/wait projection); third cross-boundary fixture.