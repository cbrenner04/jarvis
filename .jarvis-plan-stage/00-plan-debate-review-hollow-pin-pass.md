# Plan debate review hollow-pin pass

## Problem

`linkDirectivesToCriterion` links a `// @mutate` directive only when the criterion text contains the directive's pin title. A mutation-checkpoint criterion that names the pinning file and directive but omits the enclosing `test()` title goes **hollow** at implement time even when the directive is correct. Plans keep authoring that shape; implement runs burn before the referential miss is obvious.

## Decisions

- Plan debate review gains a hollow-pin pass for mutation-checkpoint criteria: flag a criterion whose text names no plausible enclosing test title (heuristic: no backticked/quoted test-name-like token beyond the pinning file path and `@mutate` directive text) as an **at-risk hollow pin** — rules out discovering the referential miss only at implement time.
- Hollow-pin detection and injection live in `shared/prompts/review-plan.ts`, wired into plan debate role rendering (`renderPlanReviewDebateRolePrompt`) via `REVIEW_PASS_CONTEXT` — rules out duplicating the check in the intent-split prompt or only in static prompt prose without a testable heuristic.
- Scan only mutation-checkpoint-shaped acceptance criteria: selected by `Mutation checkpoint:` or a directive-shaped `@mutate` occurrence per `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — rules out flagging prose that merely mentions `@mutate`.
- A well-formed criterion that backtick- or quote-names its enclosing test title (linker-matching substring) is not flagged — rules out false positives on criteria that already satisfy `linkDirectivesToCriterion`.
- Debate adversary prompt gains a short instruction to surface injected at-risk hollow-pin findings; advocate and adjudicator prompts unchanged beyond receiving the enriched `REVIEW_PASS_CONTEXT` — rules out a fourth bespoke debate role.
- Independent of `plan-review-must-falsify-guard-premises` (same seam; serial sibling ordering) — rules out blocking on that seed or merging premise-falsification into this pass.
- Out of scope: reintroducing the all-directives-in-file fallback; v1 `buildReviewPrompt` wiring (`v1` maintenance path does not import `review-plan.ts` today).
- Authoring and operator guidance for the pin-title requirement ship in `mutation-checkpoint-criterion-enclosing-test-docs` — rules out doc churn in this subspec.

## Tasks

- Add a hollow-pin heuristic in `shared/prompts/review-plan.ts` that walks drafted spec markdown, collects mutation-checkpoint-shaped acceptance-criterion blocks, and returns at-risk entries (criterion text + rationale).
- Enrich `REVIEW_PASS_CONTEXT` for plan debate roles with any at-risk hollow-pin findings from the current spec snapshot; keep pass-number context when no findings.
- Extend `prompts/plan/review-adversary.md` with a hollow-pin reporting instruction; bump its `revision` and regenerate `v1/test/fixtures/prompts/rendered/` entries covered by `rendered-snapshots.test.ts` when rendered bytes change.
- Add `shared/prompts/review-plan-hollow-pin.test.ts` with hollow vs well-formed fixture criteria and a rendered-prompt assertion that debate roles receive the injected finding.
- Add the mutation-checkpoint pin in `review-plan-hollow-pin.test.ts` naming the enclosing test verbatim.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `shared/prompts/review-plan-hollow-pin.test.ts` feeds a mutation-checkpoint criterion that names only the pinning file and directive (no enclosing test title) and asserts plan debate review rendering flags an at-risk hollow pin; a well-formed criterion naming the enclosing test in backticks does not trip it; fails against the pre-fix review roles.
- [ ] Mutation checkpoint: a `// @mutate` directive disabling the plan-review hollow-pin heuristic turns the regression RED; pin via `review-plan-hollow-pin.test.ts`, naming the enclosing test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — authoring and operator guidance ship in `mutation-checkpoint-criterion-enclosing-test-docs`.
