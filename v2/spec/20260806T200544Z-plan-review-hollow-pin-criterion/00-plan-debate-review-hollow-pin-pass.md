# Plan debate review hollow-pin pass

## Problem

`linkDirectivesToCriterion` links a `// @mutate` directive only when the criterion text contains the directive's pin title (the enclosing `test()`/`it()` title). A mutation-checkpoint criterion that names the pinning file and directive but omits the pin title goes **hollow** at implement time even when the directive is correct. Plans keep authoring that shape; implement runs burn before the referential miss is obvious.

## Decisions

- Plan debate review gains an **advisory** hollow-pin pass for mutation-checkpoint criteria: flag a criterion whose text names no plausible pin title (heuristic: no backticked/quoted pin-title-like token beyond the pinning file path and `@mutate` directive text) as an **at-risk hollow pin** — rules out discovering the referential miss only at implement time. Surfacing is prompt injection into plan debate context, not a plan-draft validator, completion blocker, or hard rejection; the implement-time linker remains the hard gate.
- Hollow-pin detection and injection live in `shared/prompts/review-plan.ts`, wired into plan debate role rendering (`renderPlanReviewDebateRolePrompt`) via `REVIEW_PASS_CONTEXT` — rules out duplicating the check in the intent-split prompt or only in static prompt prose without a testable heuristic.
- Scan scope is bounded: walk `## Acceptance criteria` checklist blocks in staged spec `.md` files only (exclude `index.md` routing lines, `intent.md`, and other sections). Skip human-only criterion blocks (same markers as the mutation-checkpoint verifier). Select mutation-checkpoint-shaped criteria per `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria (`Mutation checkpoint:` or directive-shaped `@mutate`; bare `@mutate` prose mentions do not select).
- Mutation-checkpoint criterion selection and `## Acceptance criteria` block parsing (including continuation-line parity) extract from `v2/src/execution/mutation-checkpoint-verifier.ts` into `shared/` (e.g. `shared/mutation-checkpoint-criteria.ts`) so `review-plan.ts` and the verifier share one implementation — rules out silent divergence from verifier selection behavior; extraction is required here because duplication would risk continuation-line parity drift.
- A well-formed criterion that backtick- or quote-names its pin title (linker-matching substring) is not flagged — rules out false positives on criteria that already satisfy `linkDirectivesToCriterion`. Unquoted pin-title substrings alone do not satisfy the negative case (known false-positive gap vs linker `includes` precision); authors should backtick the pin title; the AC guarantees the backtick well-formed case passes.
- `REVIEW_PASS_CONTEXT` for plan debate roles: empty when no hollow-pin findings (pass metadata already lives elsewhere in profile context); when findings exist, inject a named `## At-risk hollow pins` section listing each criterion and rationale — rules out pass-number composition that does not match today's v2 plan review.
- Same-seam sibling composition: hollow-pin and `plan-review-must-falsify-guard-premises` both enrich `REVIEW_PASS_CONTEXT` via `review-plan.ts`. Use non-destructive composition (shared builder or named sections in fixed order) so a later sibling does not clobber hollow-pin findings; document the `## At-risk hollow pins` section format for the sibling to merge around.
- Debate adversary prompt gains a short instruction to surface injected at-risk hollow-pin findings; advocate and adjudicator prompts unchanged beyond receiving the enriched `REVIEW_PASS_CONTEXT` — rules out a fourth bespoke debate role.
- Independent of `plan-review-must-falsify-guard-premises` (same seam; serial sibling ordering) — rules out blocking on that seed or merging premise-falsification into this pass.
- Out of scope: reintroducing the all-directives-in-file fallback; v1 `buildReviewPrompt` wiring (`v1` maintenance path does not import `review-plan.ts` today).
- Authoring and operator guidance for the pin-title requirement ship in `mutation-checkpoint-criterion-enclosing-test-docs` — rules out doc churn in this subspec.

## Tasks

- Extract shared mutation-checkpoint criterion block parsing and selection helpers from `mutation-checkpoint-verifier.ts` into `shared/`; update the verifier to import them.
- Add a hollow-pin heuristic in `shared/prompts/review-plan.ts` that walks bounded `## Acceptance criteria` blocks in staged spec `.md` files (skipping human-only blocks), collects mutation-checkpoint-shaped criteria via the shared selector, and returns at-risk entries (criterion text + rationale).
- Enrich `REVIEW_PASS_CONTEXT` for plan debate roles via non-destructive composition: empty when clean; otherwise a `## At-risk hollow pins` section with findings from the current spec snapshot.
- Extend `prompts/plan/review-adversary.md` with a hollow-pin reporting instruction; bump its `revision` and regenerate `v1/test/fixtures/prompts/rendered/` entries covered by `rendered-snapshots.test.ts` when rendered bytes change.
- Add `shared/prompts/review-plan-hollow-pin.test.ts` with hollow vs well-formed fixture criteria and a rendered-prompt assertion that debate roles receive the injected finding.
- Add the mutation-checkpoint pin in `review-plan-hollow-pin.test.ts` naming the enclosing test pin title verbatim.
- Run `bun run typecheck`, `bun run test:shared`, and `bun run test:v1`.

## Acceptance criteria

- [ ] `shared/prompts/review-plan-hollow-pin.test.ts` feeds a mutation-checkpoint criterion that names only the pinning file and directive (no pin title) and asserts plan debate review rendering flags an at-risk hollow pin; a well-formed criterion naming the pin title in backticks does not trip it; fails against the pre-fix review roles.
- [ ] Mutation checkpoint: a `// @mutate` directive disabling the plan-review hollow-pin heuristic turns the regression RED; pin via `review-plan-hollow-pin.test.ts`, naming the enclosing test pin title.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:v1` pass.

## Documentation updates

- None — authoring and operator guidance ship in `mutation-checkpoint-criterion-enclosing-test-docs`.
