---
name: implement-owned-prompt-artifacts
---

# Implement-owned prompt artifacts and neutral rules

## Primary implementation surface

- Prompt corpus and registry in `prompts/` and `prompts/registry.txt`

## Prerequisites

- Fragment attachment is declared in artifact frontmatter (`behavior:`, `add:`, `remove:`) and honored by one assembler — rules out mislabeled silent attachment.
- Plan and implement review-role prompts use the intent-family terse skeleton — rules out re-editing those files during implement id migration.

## Problem

- v2 implement still renders `patch.prompt.body` and `patch.rules`, headed "Patch Mode" in v1 vocabulary.
- `implement/review-*.md` carry `behavior: patch`; `intent.prompt.split` carries `behavior: plan`, silently attaching plan fragments the split step never opted into.
- `patch.rules` ships jarvis-repo-specific bun recovery, machine-config fixture, and setTimeout-guard rules to every target repo.

## Behavior

- One implement write-step body (`implement.prompt.body`) and one rules fragment (`implement.rules`) replace `patch.prompt.body` / `patch.rules`; patch shrink and v1-only review ids stay on the patch behavior lane.
- Implement body and rules prose use implement vocabulary; no "Patch Mode" heading or patch-mode sequencing labels.
- `implement/review-*.md` frontmatter `behavior:` matches actual fragment intent; `intent.prompt.split` declares any wanted plan fragments via explicit `add:` instead of inheriting them from a mislabeled behavior.
- Jarvis-repo-specific rules leave the generic rules artifact and land in this repo's injected repo guidance (`AGENTS.md` / spec guidance).

## Decision ledger

- Move body and rules to implement-owned ids with one artifact per prompt; rules out forking a second body copy to preserve the old id.
- Retire patch-mode heading and prose on the primary implement path; rules out v1 sequencing vocabulary in v2's core implement prompt.
- Correct `behavior:` and use explicit `add:` for cross-behavior fragments; rules out silent attachment via mislabeled behavior.
- Migrate jarvis-specific rules into repo guidance and keep the rules artifact target-repo-neutral; rules out shipping bun-specific recovery rules to non-bun targets and delivering them twice here.

## Acceptance criteria

- [ ] `implement.prompt.body` and `implement.rules` are registered; retired `patch.prompt.body` / `patch.rules` ids are absent from the registry.
- [ ] A render test on `implement.prompt.body` proves the assembled implement step prompt contains no "Patch Mode" text; it fails against the pre-fix patch body.
- [ ] A render test pins the `intent.prompt.split` fragment set — only globals plus explicitly declared `add:` fragments, no plan-behavior auto-attachment; it fails against the pre-fix `behavior: plan` label.
- [ ] A render test on `implement.rules` proves no jarvis-repo-specific tool commands remain; the migrated rules are present in this repo's injected guidance.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record implement-owned body/rules ids and retired patch ids.
- `v1/docs/prompt-governance.md` — ownership note for implement-owned ids.
