---
name: declarative-prompt-fragment-policy
---

# Declarative fragment policy: one prompt assembler, no string surgery, one registry parser

## Problem

Which fragments a prompt gets is decided by which of three render paths the call site happened to pick: `assemblePromptForStep` (globals + behavior fragments + add/remove), v2's `renderStepPrompt` (globals only — documented, `v2/src/execution/write-prompt.ts:5-8`), and bare `renderArtifactTemplate` (nothing). Confirmed divergence: the plan review-role ids render with global fragments under v1 (`v1/src/modes/plan/review.ts:82`) and without them under v2 (`shared/prompts/review-plan.ts:52`) — the same prompt id produces two different prompts, with no comment or spec justifying it. Same defect mechanism as the brief's dispatch-parity class: assembled twice, one copy drifts. Separately, rendered prompts are patched by string surgery — `buildPlanDraftPrompt` rewrites a rule bullet and `spec/<NAME>/` paths via `.replace` (`shared/prompts/plan-draft.ts:44-51`); `review-implement.ts:73-113` builds the implement actuator by excising sections with `stripOptionalSection` plus a `.replace` on a prose anchor — all of which silently no-op when the prompt file's prose changes. And `v2/src/execution/diff-derived-mutation-verifier.ts:102-125` re-parses `prompts/registry.txt` textually instead of using the registry module.

## Decisions

- Fragment policy is declared in artifact frontmatter (global/behavior/none), one assembler honors it, and call sites stop choosing a render path. Rules out same-id-different-render across engines.
- The v1-vs-v2 plan-review divergence is resolved to one declared policy (whichever rendering is correct is decided in the spec, then both engines get it). Rules out shipping the accidental variant forever.
- The template renderer gains optional sections and variants (flat-layout paths, omit-when-empty sections); every `.replace`/`stripOptionalSection` on rendered output is deleted, and a missing variant anchor is a hard error, not a no-op. Rules out prompt edits silently disabling a rewrite.
- The mutation verifier consumes the registry module (or a file list the registry exposes) instead of re-parsing `registry.txt`. Rules out a second parser drifting from the loader.

## Acceptance criteria

- [ ] For every shared prompt id, v1 and v2 render byte-identical output given identical inputs, pinned by a cross-engine render test.
- [ ] Grep-level absence of `stripOptionalSection` and of `.replace(` on assembled prompt strings in `shared/prompts/` and the v1/v2 prompt paths, pinned.
- [ ] A template variant referencing a missing anchor fails loudly at render time, pinned by a new test that fails against the silent-no-op behavior.
- [ ] `diff-derived-mutation-verifier` resolves prompt files through the registry surface, pinned by its tests against a registry fixture.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — fragment-policy frontmatter contract and the single assembler; `v1/docs/prompt-governance.md` — same contract from the v1 side; `v2/docs/v1-behaviors.md` — record the unified rendering where v1 behavior changes.
