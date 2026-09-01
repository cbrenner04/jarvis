---
name: declarative-fragment-policy-single-assembler
---

# Declarative fragment policy and one prompt assembler

Unsplit rationale: Fragment policy, the single assembler, and converging v1/v2 call sites onto it are one shared prompt-assembly contract; splitting by engine would land coupled halves that still diverge on the same prompt ids.

## Prerequisites

- The template renderer honors declared variants and optional sections and fails loudly when a referenced anchor is missing (`prompt-template-variants`).
- Post-render prompt string surgery on assembled step prompts is eliminated per `eliminate-prompt-string-surgery`.

## Primary implementation surface

- Shared prompt assembly in `shared/prompts/assemble.ts` and prompt dispatch in `v2/src/execution/write-prompt.ts`, `shared/prompts/review-plan.ts`, and v1 prompt call sites

## Problem

- v2 `renderStepPrompt` applies globals-only assembly (no behavior fragments, no `metadata.add`) while v1 shared builders and several v2-adjacent paths use `assemblePromptForStep` (globals + behavior + add/remove), so ids such as `write.execute`, `plan.prompt.draft`, and `patch.prompt.body` render different bytes across engines with no declared policy.

## Behavior

- Each step artifact declares `fragmentPolicy` in frontmatter (`global`, `behavior`, or `none`); one assembler in `shared/prompts/assemble.ts` honors that declaration for every engine.
- v1 and v2 call sites route step prompts through the single assembler instead of parallel render paths (`assemblePromptForStep`, v2 `renderStepPrompt`, bare `renderArtifactTemplate`).
- `plan.prompt.review.*` and `plan.prompt.review-actuator` use `fragmentPolicy: behavior`; `write.execute` uses `fragmentPolicy: global` with `PRINCIPLES` supplying `write.principles` (no duplicate write behavior fragments in assembly).

## Decision ledger

- Add an explicit per-step `fragmentPolicy` frontmatter field and centralize inclusion in one assembler (`shared/prompts/assemble.ts`); rules out call sites hand-rolling global-only or bare-template renders.
- Pin `plan.prompt.review.*` and `plan.prompt.review-actuator` to `fragmentPolicy: behavior` on both engines; rules out ad-hoc per-engine fragment omission.
- Pin `write.execute` to `fragmentPolicy: global` with `PRINCIPLES` carrying `write.principles`; rules out duplicating write behavior fragments in assembly or deferring the policy past cross-engine parity.
- Converge v2 `renderStepPrompt` onto the shared assembler (including `metadata.add`/`remove` and behavior fragments where declared); rules out a partial global-only copy in `write-prompt.ts`.

## Acceptance criteria

- [ ] `shared/prompts/cross-engine-render.test.ts` proves every shared step prompt id produces byte-identical output from v1 and v2 given identical inputs; fails against the pre-fix `renderStepPrompt` / `assemblePromptForStep` divergence on `write.execute`, `plan.prompt.draft`, and `patch.prompt.body`.
- [ ] `shared/prompts/step-prompt-dispatch-guard.test.ts` fails when production code outside `shared/prompts/assemble.ts` calls `assemblePromptForStep`, `renderStepPrompt`, or bare `renderArtifactTemplate` to build step prompts.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/prompts.md` — fragment-policy frontmatter contract and the single assembler entry point.
- `v1/docs/prompt-governance.md` — same contract from the v1 rendering side.
- `v2/docs/v1-behaviors.md` — record unified cross-engine prompt rendering where v1 behavior changes.
