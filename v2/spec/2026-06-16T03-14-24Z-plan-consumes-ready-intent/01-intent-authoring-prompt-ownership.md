# Intent-authoring prompt ownership

## Problem

Removing plan-owned intent draft/refine leaves prompt ownership stale. Intent
authoring prompts and docs should belong to `jarvis1 intent`; plan should keep
only spec draft/review prompts.

## Prerequisite

- Complete `00-ready-intent-plan-flow.md` first; this subspec only cleans prompt ownership after fresh plan starts at draft.

## Decisions

- Retire `prompts/plan/intent-draft.md` / `plan.prompt.intent-draft` and `prompts/plan/refine.md` / `plan.prompt.refine` -- rules out keeping dead plan prompt IDs for compatibility.
- Move `prompts/plan/intent-split.md` / `plan.prompt.intent-split` to intent-owned `prompts/intent/split.md` / `intent.prompt.split` -- rules out leaving active intent mode prompts under plan ownership.
- Intent authoring prompt ownership moves to intent mode docs/runtime surfaces, with no duplicate plan copy -- rules out two prompt copies drifting.
- Active plan prompt surfaces after this change are `plan.prompt.draft`, `plan.prompt.review`, `plan.prompt.review.adversary`, `plan.prompt.review.advocate`, `plan.prompt.review.adjudicator`, `plan.prompt.review-actuator`, and `plan.prompt.pr-description` -- rules out deleting spec draft/review/PR behavior while removing intent authoring.
- Shared plan fragments `plan.defer-to-consumer` and `plan.decisions-ledger` remain plan-owned where active plan prompts still use them -- rules out treating fragment cleanup as intent-authoring relocation.
- Prompt snapshot fixtures change only for prompt ownership/rendering changes required by this behavior -- rules out broad snapshot churn.
- Deferred to first consumer: whether later prerequisite enforcement gets its own prompt or pure runtime check -- pin when seed 03 implements enforcement.

## Task checklist

- [ ] Remove `plan.prompt.intent-draft` and `plan.prompt.refine` files, registry entries, governance entries, and fresh-plan render paths.
- [ ] Move intent split prompt ownership from `plan.prompt.intent-split` to `intent.prompt.split` and update `jarvis1 intent` to use the intent-owned ID.
- [ ] Keep `prompts/plan/draft.md`, `prompts/plan/review.md`, plan review role prompts, `prompts/plan/review-actuator.md`, `prompts/plan/pr-description.md`, and required plan fragments wired for the collapsed plan flow.
- [ ] Update rendered prompt fixtures only where retained plan prompt output changes for ready-intent input.
- [ ] Ensure intent-mode docs describe where raw-seed authoring/refinement now lives when plan docs point operators there.
- [ ] Add or update prompt registry/rendering tests proving removed plan intent-authoring prompts are unavailable to plan and retained plan prompts still render.

## Acceptance criteria

- [x] Plan prompt registry/governance docs no longer list `plan.prompt.intent-draft`, `plan.prompt.refine`, or `plan.prompt.intent-split` as active plan prompts.
- [x] `jarvis1 intent` uses an intent-owned split prompt ID/file, and no intent-authoring prompt is duplicated under plan ownership.
- [x] Active plan prompt surfaces are limited to `plan.prompt.draft`, `plan.prompt.review`, `plan.prompt.review.adversary`, `plan.prompt.review.advocate`, `plan.prompt.review.adjudicator`, `plan.prompt.review-actuator`, `plan.prompt.pr-description`, and the plan fragments those prompts use.
- [x] Prompt tests prove fresh plan cannot load or render the retired plan intent-authoring prompt IDs through plan prompt lookup.
- [x] Plan draft/review/review-actuator prompt snapshots reflect the ready-intent input model and still include sentinel-delimited intent data plus spec guidance.
- [x] `v1/docs/intent-mode.md`, `v1/docs/prompt-governance.md`, `v2/docs/prompts.md`, and `v2/docs/v1-behaviors.md` agree that raw-seed authoring belongs before plan and that plan starts at spec draft.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/prompt-governance.md`: active prompt ownership and registry entries.
- `v2/docs/prompts.md`: prompt ownership/relocation notes if affected.
- `v1/docs/intent-mode.md`: raw-seed authoring handoff referenced by plan docs.
- `v2/docs/v1-behaviors.md`: prompt/runtime ownership and active plan prompt surface.
