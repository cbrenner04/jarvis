---
name: authored-markdown-no-hard-wrap-prompt
---

# Authored markdown no-hard-wrap prompt directive

## Problem

Agents hard-wrap specs, ready-intents, seeds, docs, and PR bodies at ~100 columns by habit. Nothing requires it: `MD013` is off and no prompt forbids wrapping. Wrapped prose splits `@mutate` directives and acceptance-criterion bullets across physical lines, blocking implement runs and forcing parser workarounds.

## Decisions

- Add `prompts/global/no-hard-wrap.md` with id `global.no-hard-wrap`, `behavior: global`, `kind: fragment`, and `order: 3` after `global.terse` (`order: 2`) — rules out ad hoc ids or unstable fragment ordering (`global.documentation`/`global.naming`/`global.terse` keep `order` 0–2).
- Body: one physical line per paragraph and per list item; no hard line-wrapping in authored markdown.
- Fragment auto-composes into intent, plan, write, and patch step prompts via global fragment assembly — rules out manual per-step injection.
- Global fragment changes shift every `assemblePromptForStep` render; bump affected step `revision` values and regenerate keyed fixtures under `v1/test/fixtures/prompts/rendered/` per prompt-governance — rules out stale rendered snapshots.
- `@mutate` directives in code comments stay single-line — rules out relaxing the existing mutation-checkpoint contract.
- `MD013` stays `false` — rules out max-length enforcement in this intent.

## Acceptance criteria

- [ ] `global.no-hard-wrap` is registered in `prompts/registry.txt`; `shared/prompts/registry.test.ts` fails against the pre-fix registry.
- [ ] `assemblePromptForStep` composes `global.no-hard-wrap` into `intent.prompt.split`, `plan.prompt.draft`, and `write.execute`; `shared/prompts/intent-split.test.ts` and `v2/src/execution/write-prompt.test.ts` fail against the pre-fix assembly for those steps.
- [ ] Patch step prompts that receive global fragments include the no-hard-wrap text; `v1/test/prompt.test.ts` fails against the pre-fix `buildPrompt` output.
- [ ] Affected rendered fixtures are regenerated; `v1/test/prompts/rendered-snapshots.test.ts` stays green.
- [ ] `bun run typecheck` and the touched test scope pass.

## Documentation updates

- `v1/docs/prompt-governance.md` — catalog `global.no-hard-wrap`; update patch/plan global layering bullets.
- `v2/docs/v1-behaviors.md` — record that global prompt assembly includes the no-hard-wrap directive.
- `AGENTS.md` — note the no-hard-wrap convention alongside "be terse."

## Prerequisites
