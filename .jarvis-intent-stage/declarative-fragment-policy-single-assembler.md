---
name: declarative-fragment-policy-single-assembler
---

# Declarative fragment policy and one prompt assembler

## Prerequisites

- The template renderer honors declared variants and optional sections and fails loudly when a referenced anchor is missing.
- Post-render `.replace` and `stripOptionalSection` are absent from shared and v1/v2 prompt assembly paths.

## Primary implementation surface

- Shared prompt assembly in `shared/prompts/assemble.ts` and prompt dispatch in `v2/src/execution/write-prompt.ts`, `shared/prompts/review-plan.ts`, and v1 prompt call sites

## Problem

- Fragment inclusion depends on which render path a call site picked (`assemblePromptForStep`, v2 `renderStepPrompt`, or bare `renderArtifactTemplate`), so the same prompt id can render different bytes across engines with no declared policy.

## Behavior

- Each step artifact declares fragment policy in frontmatter (`global`, `behavior`, or `none`); one assembler honors that declaration for every engine.
- v1 and v2 call sites route through the single assembler instead of choosing parallel render paths.
- Plan review-role prompts use one declared fragment policy on both engines.

## Decision ledger

- Add an explicit per-step `fragmentPolicy` frontmatter field and centralize inclusion in one assembler; rules out call sites hand-rolling global-only or bare-template renders.
- Resolve the v1/v2 plan-review fragment divergence to the policy chosen in this spec, then apply it on both engines; rules out shipping the accidental variant forever.
- Converge v2 `renderStepPrompt` onto the shared assembler (including `metadata.add`/`remove` and behavior fragments where declared); rules out a partial global-only copy in `write-prompt.ts`.
- Deferred to first consumer: whether `write.execute` uses `fragmentPolicy: none` with `PRINCIPLES` carrying write behavior fragments — pin when converging write-step assembly.

## Acceptance criteria

- [ ] A cross-engine render test proves every shared prompt id produces byte-identical output from v1 and v2 given identical inputs; it fails against the pre-fix `renderStepPrompt` / `assemblePromptForStep` divergence.
- [ ] A structural test fails when production code outside the assembler module calls `assemblePromptForStep`, `renderStepPrompt`, or bare `renderArtifactTemplate` to build step prompts.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/prompts.md` — fragment-policy frontmatter contract and the single assembler entry point.
- `v1/docs/prompt-governance.md` — same contract from the v1 rendering side.
- `v2/docs/v1-behaviors.md` — record unified cross-engine prompt rendering where v1 behavior changes.
