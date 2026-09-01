---
name: eliminate-prompt-string-surgery
---

# Eliminate post-render prompt string surgery

## Prerequisites

- The template renderer honors declared variants and optional sections and fails loudly when a referenced anchor is missing (`prompt-template-variants`).

## Primary implementation surface

- Shared prompt builders in `shared/prompts/plan-draft.ts`, `shared/prompts/review-implement.ts`, v1 plan review prompt assembly in `v1/src/modes/plan/review.ts`, v1 verdict actuator assembly in `v1/src/modes/plan/verdict-actuator.ts`, and v1 patch prompt assembly in `v1/src/modes/patch/prompt.ts`

## Problem

- `buildPlanDraftPrompt`, implement review actuator assembly, v1 plan review, v1 verdict actuator, and v1 patch prompt assembly rewrite rendered output via `.replace` and `stripOptionalSection`; prompt prose edits silently disable those transforms.

## Behavior

- Plan-draft flat and nested spec-path layouts, implement actuator optional sections, v1 verdict-actuator flat/nested layout, and v1 patch optional-section omission are expressed through template variants or optional sections instead of post-render patches.
- v1 plan-review assembly drops dead pre-render `.replaceAll` path surgery; current `plan.prompt.review.*` debate templates carry no `spec/<NAME>/` layout anchors to migrate.
- `stripOptionalSection`, `stripOptionalPromptSection`, `.replace(`, and `.replaceAll(` on assembled prompt strings are absent from the five assembly builders (`plan-draft.ts`, `review-implement.ts`, `v1/.../review.ts`, `v1/.../verdict-actuator.ts`, `v1/.../patch/prompt.ts`).

## Decision ledger

- Migrate each existing string-surgery site to declared template variants or optional sections; rules out retaining silent post-render rewrites as a compatibility shim.
- Delete `stripOptionalSection` once all call sites migrate; rules out leaving a shared helper for ad-hoc excision.
- Adopt `renderArtifactTemplate` trim-based optional-section emptiness for patch optional sections; rules out retaining v1 `content.length === 0` strict check via call-site bridging.

## Acceptance criteria

- [ ] `shared/prompts/no-prompt-surgery-guard.test.ts` fails when `stripOptionalSection`, `stripOptionalPromptSection`, `.replace(`, or `.replaceAll(` appears in the five guarded assembly builders.
- [ ] `shared/prompts/plan-draft.test.ts` — flat and nested layout regression tests fail against pre-fix `.replace` surgery in `plan-draft.ts` and pass after template-variant migration.
- [ ] `shared/prompts/review-implement.test.ts` — optional-section omission regression test fails against pre-fix `stripOptionalSection` in `review-implement.ts` and passes after declared `optionalSections` migration.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:shared` pass.

## Documentation updates
