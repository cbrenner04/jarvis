# No prompt surgery guard

Post-render `.replace`, `.replaceAll`, and optional-section strip helpers on assembled prompt strings can reappear silently after migration; a static guard pins the invariant on the five assembly builders.

## Decisions

- Add `shared/prompts/no-prompt-surgery-guard.test.ts` that reads source text and fails when `stripOptionalSection`, `stripOptionalPromptSection`, `.replace(`, or `.replaceAll(` appears in guarded assembly files — rules out ad-hoc reintroduction without a test failure.
- Guard paths: `shared/prompts/plan-draft.ts`, `shared/prompts/review-implement.ts`, `v1/src/modes/plan/review.ts`, `v1/src/modes/plan/verdict-actuator.ts`, and `v1/src/modes/patch/prompt.ts` — rules out scanning all of `shared/prompts/` (false-positives in `render.ts`, `registry.ts`, `review-plan.ts`, and test files).
- Match forbidden tokens as literal source substrings in those assembly files only — rules out repo-wide string-replace bans.

## Tasks

- Add `shared/prompts/no-prompt-surgery-guard.test.ts` with the guarded path list and failure messages citing the forbidden construct.

## Acceptance criteria

- [ ] `shared/prompts/no-prompt-surgery-guard.test.ts` fails when `stripOptionalSection`, `stripOptionalPromptSection`, `.replace(`, or `.replaceAll(` appears in `shared/prompts/plan-draft.ts`, `shared/prompts/review-implement.ts`, `v1/src/modes/plan/review.ts`, `v1/src/modes/plan/verdict-actuator.ts`, or `v1/src/modes/patch/prompt.ts`.

## Documentation updates

- None. Internal invariant guard.
