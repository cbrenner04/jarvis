# global.no-hard-wrap fragment

## Problem

Agents hard-wrap specs, ready-intents, seeds, docs, and PR bodies at ~100 columns by habit. `MD013` is off and no prompt forbids wrapping. Wrapped prose splits `@mutate` directives and acceptance-criterion bullets across physical lines, blocking implement runs and forcing parser workarounds.

## Decisions

- Add `prompts/global/no-hard-wrap.md` with id `global.no-hard-wrap`, `behavior: global`, `kind: fragment`, `revision: 1`, `order: 3` after `global.terse` (`order: 2`) — rules out ad hoc ids or unstable fragment ordering (`global.documentation`/`global.naming`/`global.terse` keep `order` 0–2).
- Body: one physical line per paragraph and per list item; no hard line-wrapping in authored markdown — rules out vague “avoid wrapping” without the paragraph/list-item contract.
- Rely on `assemblePromptForStep` global-fragment discovery — rules out manual per-step `globalFragmentIds` wiring.
- Global fragment changes shift every `assemblePromptForStep` render; bump affected step `revision` values and regenerate keyed fixtures under `v1/test/fixtures/prompts/rendered/` per prompt-governance — rules out stale rendered snapshots.
- `@mutate` directives in code comments stay single-line — rules out relaxing the mutation-checkpoint contract.
- `MD013` stays `false` — rules out max-length lint enforcement in this slice (lint corpus work is a separate intent).
- `patch.prompt.shrink` keeps `remove: [global.documentation, global.naming]`; auto-compose adds `global.no-hard-wrap` after `global.terse` — rules out hand-wiring shrink globals or stripping no-hard-wrap from shrink.

## Tasks

- [ ] Add `prompts/global/no-hard-wrap.md` and register `global/no-hard-wrap.md` in `prompts/registry.txt`.
- [ ] Extend `shared/prompts/registry.test.ts` to assert `global.no-hard-wrap` loads.
- [ ] Extend `shared/prompts/intent-split.test.ts` to assert `buildIntentSplitPrompt` output includes the no-hard-wrap fragment text.
- [ ] Extend `v2/src/execution/write-prompt.test.ts` to assert `renderStepPrompt("write.execute", …)` and `renderStepPrompt("plan.prompt.draft", …)` include the no-hard-wrap fragment text.
- [ ] Extend `v1/test/prompt.test.ts` to assert `buildPrompt` output includes the no-hard-wrap fragment text after `global.terse`.
- [ ] Bump `revision` on every step prompt covered by `v1/test/prompts/rendered-snapshots.test.ts` (patch body, plan draft/review roles, plan review-actuator, patch review adversary, patch/plan PR-description) plus `intent.prompt.split` and `write.execute` when assembly tests pin their output; regenerate fixtures and update revision assertions in `rendered-snapshots.test.ts`.
- [ ] Update docs per Documentation updates.

## Acceptance criteria

- [ ] `shared/prompts/registry.test.ts` asserts `global.no-hard-wrap` is in the loaded artifact set; fails against the pre-fix registry.
- [ ] `shared/prompts/intent-split.test.ts` asserts `buildIntentSplitPrompt` includes the no-hard-wrap fragment text; fails against the pre-fix assembly.
- [ ] `v2/src/execution/write-prompt.test.ts` asserts `write.execute` and `plan.prompt.draft` renders include the no-hard-wrap fragment text; fails against the pre-fix assembly.
- [ ] `v1/test/prompt.test.ts` asserts `buildPrompt` includes the no-hard-wrap fragment text; fails against the pre-fix output.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` stays green against regenerated revision-keyed fixtures.
- [ ] Mutation checkpoint: the intent-split assembly test in `shared/prompts/intent-split.test.ts` carries `// @mutate prompts/global/no-hard-wrap.md "behavior: global" -> "behavior: archived"`; applying it turns that test red.
- [ ] `bun run typecheck` and touched test scope (`shared/**` → `test:v1` + `test:v2` + `test:integration:v2`) pass.

## Documentation updates

- `v1/docs/prompt-governance.md` — catalog `global.no-hard-wrap`; update patch/plan global layering bullets to append `global.no-hard-wrap` after `global.terse`; update shrink layering to `global.terse -> global.no-hard-wrap`.
- `v2/docs/v1-behaviors.md` — record that global prompt assembly includes the no-hard-wrap directive.
- `AGENTS.md` — note the no-hard-wrap convention alongside “be terse.”
