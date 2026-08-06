---
name: authored-markdown-no-hard-wrap-prompt
---

# Authored markdown no-hard-wrap prompt directive

## Problem

Agents hard-wrap specs, ready-intents, seeds, docs, and PR bodies at ~100 columns by habit. Nothing requires it: `MD013` is off and no prompt forbids wrapping. Wrapped prose splits `@mutate` directives and acceptance-criterion bullets across physical lines, blocking implement runs and forcing parser workarounds.

## Decisions

- Add a `behavior: global` prompt fragment registered in `prompts/registry.txt` instructing one physical line per paragraph and per list item with no hard line-wrapping — rules out per-workflow copy or a max-length prompt substitute.
- Fragment auto-composes into intent, plan, write, and patch step prompts via global fragment assembly — rules out manual per-step injection.
- `@mutate` directives in code comments stay single-line — rules out relaxing the existing mutation-checkpoint contract.
- `MD013` stays `false` — rules out max-length enforcement in this intent.

## Acceptance criteria

- [ ] `prompts/global/` carries a registered no-hard-wrap fragment; `shared/prompts/registry.test.ts` fails when its id is missing from the loaded registry.
- [ ] `assemblePromptForStep` composes the fragment into `intent.prompt.split`, `plan.prompt.draft`, and `write.execute` bodies; a test fails against the pre-fix assembly.
- [ ] Patch step prompts that receive global fragments include the no-hard-wrap text; a test fails against the pre-fix assembly.
- [ ] `bun run typecheck` and the touched test scope pass.

## Documentation updates

- `AGENTS.md` — note the no-hard-wrap convention alongside "be terse."

## Prerequisites
