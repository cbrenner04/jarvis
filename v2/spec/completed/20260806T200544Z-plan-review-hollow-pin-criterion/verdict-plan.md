# Adjudicator verdict: plan review hollow-pin criterion

## Required refinements

1. **Acceptance criteria must match touched surfaces.** The new regression lives under `shared/prompts/`; CI and repo working rules union `test:shared` (and `test:v1` when v1 prompt fixtures change). The AC that only requires `bun run test:v2` is an incomplete contract — an implementer could satisfy it without running the suite that executes the new test. Require `test:shared` at minimum. Because tasks include adversary template revision and rendered-snapshot regeneration, also require `test:v1` (or an equivalent rendered-snapshot gate) when that static prose changes.

2. **State advisory-only enforcement.** Hollow-pin surfacing is prompt injection into plan debate context, not a plan-draft validator or completion blocker. The spec should say this explicitly so operators do not expect hard rejection or automatic plan failure — the implement-time linker remains the hard gate.

3. **Pin scan scope and exclusions.** The walker must be bounded: scan `## Acceptance criteria` checklist blocks in staged spec `.md` files only (not `index.md` routing lines, `intent.md` prose, or other sections). Skip human-only criterion blocks (same markers as the mutation-checkpoint verifier). Select mutation-checkpoint-shaped criteria per spec-guidance (`Mutation checkpoint:` or directive-shaped `@mutate`; bare `@mutate` mentions do not select).

4. **Decide mutation-checkpoint selection parsing strategy.** Selection logic already exists in `v2/src/execution/mutation-checkpoint-verifier.ts` but `shared/**` cannot import `v2/**`. The spec must choose duplicate-in-`review-plan.ts` vs extract-to-shared, with a criterion for when extraction is required (e.g. non-trivial duplication or continuation-line parity risk). Without this, implementers may silently diverge from verifier selection behavior.

5. **Resolve `REVIEW_PASS_CONTEXT` / pass-number ambiguity.** The task to "keep pass-number context when no findings" does not match current v2 plan review, which hardcodes empty `REVIEW_PASS_CONTEXT` while pass metadata lives elsewhere in profile context. Either drop that language (honest about today's v2 behavior: empty when clean, hollow-pin findings when present) or scope a defined pass-metadata composition for plan debate roles. Do not leave both the task line and undefined v2 behavior in place.

6. **Own the heuristic–linker precision tradeoff.** The hollow-pin heuristic (backtick-/quote-wrapped test-name-like tokens beyond pinning file and directive text) is intentionally weaker than `linkDirectivesToCriterion` (`criterionText.includes(directive.pinTitle)`). The spec must state what happens for unquoted pin-title substrings: accept as known false-positive risk with a nudge toward backticks, or require linker-aligned substring detection in the well-formed negative case. The AC already guarantees the backtick case passes; the decision prose should match that contract and name the unquoted gap if it remains.

7. **Forward-compat note for same-seam sibling composition.** This pass and `plan-review-must-falsify-guard-premises` both inject into `REVIEW_PASS_CONTEXT` via `review-plan.ts`. Serial independence is correct, but the spec should require non-destructive composition (named sections in fixed order, or a shared builder both siblings use) so the second lander does not clobber hollow-pin findings. At minimum, hollow-pin must document its section format so the sibling can merge around it.

8. **Fix prerequisite wording.** The prerequisite citing "mutation-checkpoint criteria authoring guidance requires including the directive's pin title" overstates committed doc state — that guidance ships in a sibling docs intent. Reword to the observable linker prerequisite: `linkDirectivesToCriterion` links only when criterion text contains the directive's pin title (no all-directives-in-file fallback).

9. **Standardize on "pin title" terminology.** Use pin title (linker term for the enclosing `test()`/`it()` title) consistently instead of mixing "enclosing test title" and "test-name-like token," so implementers check the same string class the linker uses.

## Not required (scope upheld)

- v1 `buildReviewPrompt` wiring, light plan review (`plan-reviewed-light`), or opening pinning files at plan time.
- Naming the exact mutation guard site in tasks (implementer chooses stable anchor per spec-guidance).
- Preservation AC citing existing review tests (covered by scoped test commands).
- Documentation updates in this subspec (correctly deferred to `mutation-checkpoint-criterion-enclosing-test-docs`).

## Rationale

The spec is atomic and targets the right seam (v2 plan debate via `review-plan.ts`). Remaining gaps are contract completeness: test commands must match file placement, scan boundaries must prevent noise and scope creep, parsing and `REVIEW_PASS_CONTEXT` composition must be decided before implement to avoid rework when the falsify-guard sibling lands, and heuristic limits must be explicit so the advisory pass is not mistaken for linker parity or hard enforcement. These refinements align the written spec with spec-guidance mutation-checkpoint rules, harness subspec conventions, and the stated intent of surfacing hollow-pin risk at plan time rather than after implement burns.