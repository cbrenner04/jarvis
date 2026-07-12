---
name: plan-draft-write-loop-prompt
---

# v2 plan draft prompt carries write-loop file-output and done-token contract

v2 `executePlanDraftWrite` renders `plan.prompt.draft` without the file-output suffix and write-loop step-rules tail that `intent.prompt.split` already gets, so plan workflow agents dump prose to stdout and fail `invalid_token`. Extract a shared plan-draft prompt builder (`shared/prompts/plan-draft.ts`, mirroring `intent-split.ts`); wire v2 plan draft execution through it with `stepRules`; refactor v1 `buildDraftPrompt` onto the shared builder without changing v1 plan-mode behavior.

## Decisions

- Fix the prompt contract, not the token parser — rules out loosening `invalid_token` handling or accepting prose terminations.
- Share builder in `shared/prompts/plan-draft.ts` consumed by v1 and v2 — rules out duplicating suffix assembly per engine.
- Append runtime file-output instructions and step-completion rules outside the governed registry artifact — rules out baking staging paths or terminal tokens into `prompts/plan/draft.md` revision bumps.
- v1 plan mode keeps direct agent invocation (no write loop) — rules out forcing v1 draft through v2 write-loop machinery.
- Spec dir naming stays in rendered `SPEC_GUIDANCE` plus the existing `spec/<NAME>/`→`<targetDir>/<NAME>/` rewrite — rules out a separate timestamp instruction block.

## Scope

- `shared/prompts/plan-draft.ts` + co-located tests.
- v1 `buildDraftPrompt` delegates to the shared builder.
- v2 `executePlanDraftWrite` uses the shared builder with `stepRules` and spec-dir path rewrite.
- `v2/src/execution/write.test.ts` asserts file-output suffix and step rules in the rendered plan-draft prompt.

## Out of scope

- Other v2 prompts — separate audit intent.
- Making `invalid_token` resumable.

## Documentation updates

- `v2/docs/prompts.md` — note `plan.prompt.draft` write-loop steps receive runtime file-output and step-completion suffixes (same pattern as `intent.prompt.split`).

## Prerequisites

- v2 intent split write step appends file-output suffix and write-loop step rules via `shared/prompts/intent-split.ts`.
- v2 plan workflow write step invokes an agent and enforces terminal tokens through the write loop.
