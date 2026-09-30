# Review-feedback write prompt corpus

## Problem

Admission prepares a write step with placeholder prompt `review-feedback.prompt.pending`; no `prompts/review-feedback/` corpus, render-observer map entries, or render tests exist for the real write contract.

## Decisions

- Prompt home is `prompts/review-feedback/` with a registered step prompt id `review-feedback.prompt.write` and companion `review-feedback.rules` (same split as implement write: body + rules fragment); ids listed in `prompts/registry.txt` — rules out reusing `write.execute` or `implement.prompt.body` verbatim.
- Frontmatter: `write.md` is `kind: step`, `behavior: review-feedback`, `fragmentPolicy: global`; `rules.md` is `kind: fragment` on lane `behavior: review-feedback-rules`, which no step declares (same as `implement-rules`), so it reaches the prompt only via `STEP_RULES` — rules out assembly prepending it a second time.
- `shared/prompts/review-feedback-write.ts` assembles the write prompt with placeholders `REVIEW_INPUT` (serialized `.jarvis-pr-review-input.json` contents), `LANE_KIND` (`intent` | `plan` | `implement`), `LANE_CONTEXT` (kind-specific paths only: intent → ready-intents/ + seed-split targets; plan → admitted spec tree root; implement → project root + lane spec path for code context), and `STEP_RULES`, rendered through `renderPromptForStep` (`shared/prompts/assemble.ts`) — rules out bypassing the assembler (`step-prompt-dispatch-guard.test.ts`) or injecting implement linked-index fields (`ACTIVE_SUBSPEC`, index routing checklist, subspec path pins).
- Write-step `stepRules` for the loader are `DEFAULT_WRITE_STEP_RULES` with `STEP_RULES` filled from the rendered `review-feedback.rules` registry body only — rules out appending `implement.rules` or implement AC-tick / linked-index step rules.
- Prompt contract forbids acceptance-criteria ticking, index or subspec routing edits, and scope beyond captured PR feedback — rules out restating implement `rules.md` AC-tick mechanics.
- Coherence pins: `shared/prompts/review-feedback-write.test.ts` asserts exactly-once occurrence of each load-bearing phrase from `prompts/review-feedback/rules.md` § Scope (body after frontmatter): `Do not tick`, ``Do not edit `index.md` ``, `captured PR feedback` — same obligation as the phrase list in `shared/prompts/plan-draft.test.ts`, not a pattern-only comment — rules out duplicating those strings in `write.md`.
- Register every new prompt path in `shared/prompts/render-observer-tests.ts` with observer tests under `shared/prompts/review-feedback-write.test.ts` — rules out orphan prompts that fail mutation verification closed.

## Tasks

- Add `prompts/review-feedback/write.md` and `prompts/review-feedback/rules.md`; list them in `prompts/registry.txt`.
- Implement `buildReviewFeedbackWritePrompt` and export stable prompt id constants.
- Add render-observer map entries and `shared/prompts/review-feedback-write.test.ts` (coherence pins + lane-kind placeholder coverage); extend `shared/prompts/cross-path-render.test.ts` to cover `review-feedback.prompt.write`.
- Extend `v2/src/execution/write-prompt.test.ts` (or the new shared test file) to render all three lane kinds and assert `REVIEW_INPUT` and `LANE_CONTEXT` are present and implement renders omit index-routing placeholder names.

## Acceptance criteria

- [x] `shared/prompts/review-feedback-write.test.ts` fails against the pre-fix registry and passes after registration; it asserts single-occurrence coherence pins for `Do not tick`, ``Do not edit `index.md` ``, and `captured PR feedback`, and renders intent, plan, and implement `LANE_CONTEXT` shapes without implement index-routing bindings.
- [x] Every path under `prompts/review-feedback/` that the registry exposes has a non-empty entry in `shared/prompts/render-observer-tests.ts` naming `shared/prompts/review-feedback-write.test.ts`.
- [x] `bun run typecheck` passes.
- [ ] `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — § Per-workflow step prompts: add `review-feedback.prompt.write` (placeholders, `fragmentPolicy`) and `review-feedback.rules` (lane, injected via `STEP_RULES`); add `review-feedback-rules` to the lane list. Operator and runner docs land in subspec `03`.
