---
name: eliminate-prompt-string-surgery
---

# Eliminate post-render prompt string surgery

## Prerequisites

- The template renderer honors declared variants and optional sections and fails loudly when a referenced anchor is missing.

## Primary implementation surface

- Shared prompt builders in `shared/prompts/plan-draft.ts`, `shared/prompts/review-implement.ts`, and v1 plan review prompt assembly in `v1/src/modes/plan/review.ts`

## Problem

- `buildPlanDraftPrompt`, implement review actuator assembly, and v1 plan review rewrite rendered output via `.replace` and `stripOptionalSection`; prompt prose edits silently disable those transforms.

## Behavior

- Plan-draft flat and nested spec-path layouts, implement actuator optional sections, and v1 plan-review path substitution are expressed through template variants or optional sections instead of post-render patches.
- `stripOptionalSection` and `.replace(` on assembled prompt strings are absent from `shared/prompts/` and v1 plan-review prompt assembly.

## Decision ledger

- Migrate each existing string-surgery site to declared template variants or optional sections; rules out retaining silent post-render rewrites as a compatibility shim.
- Delete `stripOptionalSection` once all call sites migrate; rules out leaving a shared helper for ad-hoc excision.

## Acceptance criteria

- [ ] A structural test fails when `stripOptionalSection` or `.replace(` appears on assembled prompt strings under `shared/prompts/` or in v1 plan-review prompt assembly paths.
- [ ] `shared/prompts/plan-draft.test.ts` proves flat and nested plan-draft renders match the pre-fix intended prose without post-render `.replace`.
- [ ] `shared/prompts/review-implement.test.ts` proves the implement review actuator omits empty optional sections without `stripOptionalSection`.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:shared` pass.

## Documentation updates
