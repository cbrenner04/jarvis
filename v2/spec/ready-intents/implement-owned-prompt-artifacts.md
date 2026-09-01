---
name: implement-owned-prompt-artifacts
---

# Implement-owned prompt artifacts and neutral rules

## Primary implementation surface

- Prompt corpus and registry in `prompts/` and `prompts/registry.txt`

## Prerequisites

- none

## Problem

- v2 implement still renders `patch.prompt.body` and `patch.rules`, headed "Patch Mode" in v1 vocabulary.
- `implement/review-*.md` carry `behavior: patch`; `intent.prompt.split` carries `behavior: plan`, silently attaching plan fragments the split step never opted into.
- `patch.rules` ships jarvis-repo-specific bun recovery, machine-config fixture, and setTimeout-guard rules to every target repo.

## Behavior

- One implement write-step body (`implement.prompt.body`) and one rules fragment (`implement.rules`) replace `patch.prompt.body` / `patch.rules`; patch shrink and v1-only review ids stay on the patch behavior lane.
- Implement body and rules prose use implement vocabulary; no "Patch Mode" heading or patch-mode sequencing labels.
- `implement/review-*.md` use `behavior: implement` (new lane; no behavior fragments today); `intent.prompt.split` uses `behavior: intent` with no `add:` — globals plus existing `remove: [global.naming]` only, not inherited plan fragments.
- `implement.prompt.body` keeps the `<PATCH_RULES>` placeholder key; binding resolves `implement.rules` by id (no template placeholder rename).
- Jarvis-repo-specific rules leave the generic rules artifact and land in this repo's injected repo guidance (`AGENTS.md` / spec guidance).

## Decision ledger

- Move body and rules to implement-owned ids with one artifact per prompt; rules out forking a second body copy to preserve the old id.
- Retire patch-mode heading and prose on the primary implement path; rules out v1 sequencing vocabulary in v2's core implement prompt.
- Correct `behavior:` labels (`implement` review roles, `intent` split) and drop silent plan-fragment attachment; rules out mislabeled `behavior: patch` / `behavior: plan` auto-attachment.
- Keep `<PATCH_RULES>` as the rules placeholder key while retiring `patch.rules`; rules out churn in body template declarations during id migration.
- Migrate jarvis-specific rules into repo guidance and keep the rules artifact target-repo-neutral; rules out shipping bun-specific recovery rules to non-bun targets and delivering them twice here.

## Acceptance criteria

- [ ] `implement.prompt.body` and `implement.rules` are registered; retired `patch.prompt.body` / `patch.rules` ids are absent from the registry.
- [ ] A render test on `implement.prompt.body` proves the assembled implement step prompt contains no "Patch Mode" text; it fails against the pre-fix patch body.
- [ ] A render test pins the `intent.prompt.split` fragment set — globals only (no `plan.decisions-ledger`, no `plan.defer-to-consumer`); it fails against the pre-fix `behavior: plan` label.
- [ ] A render test on `implement.rules` proves no jarvis-repo-specific tool commands remain; the migrated rules are present in this repo's injected guidance.
- [ ] `bun run typecheck` and prompt-corpus tests (`shared/prompts/assemble.test.ts`, `shared/prompts/intent-split.test.ts`, plus new render/registry tests above) pass; retired ids may remain at unwired v1/v2 call sites until wiring subspecs land.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record implement-owned body/rules ids and retired patch ids.
- `v1/docs/prompt-governance.md` — ownership note for implement-owned ids.
