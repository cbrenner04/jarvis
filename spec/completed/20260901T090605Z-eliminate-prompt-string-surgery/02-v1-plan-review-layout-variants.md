# v1 plan review layout variants

`buildReviewPrompt` in `v1/src/modes/plan/review.ts` applies `.replaceAll` path substitutions on the assembled review template before v1 `renderTemplate`.

## Decisions

- Switch plan review assembly to `renderArtifactTemplate` on the registry artifact; drop the pre-render `.replaceAll` block in `review.ts` — rules out post-render path surgery (reachable on `v1/src/modes/plan/review.ts` today even though current `plan.prompt.review.*` bodies carry no `spec/<NAME>/` anchors).
- Apply the shared flat/nested variant selection contract only when a review artifact declares matching `variants` frontmatter; do not add variant frontmatter to debate templates that lack layout anchors — rules out no-op variant metadata churn.
- Catch `PromptRenderingError` from `renderArtifactTemplate` and rethrow as `review prompt configuration error: …` — rules out surfacing raw `PromptRenderingError` and rules out dropping today's `TemplateRenderingError` prefix mapping.

## Tasks

- Replace pre-render `.replaceAll` in `buildReviewPrompt` with `renderArtifactTemplate` on the assembled step body and placeholder values.
- Map `PromptRenderingError` to `review prompt configuration error:` in the existing `try`/`catch` around template render.

## Acceptance criteria

- [x] `v1/test/modes/plan/prompts.test.ts` stays green.
- [x] `v1/test/modes/plan/prompts.test.ts` — `buildReviewPrompt` configuration-failure test asserts `review prompt configuration error:` prefix; fails against missing `PromptRenderingError` catch/wrap and passes after migration.

## Documentation updates

- None. Rendered review prompt bytes unchanged.
