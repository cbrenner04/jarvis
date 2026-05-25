# 00 - global.naming prompt fragment

## Problem

A v2 spec titled "Phase 1 state store" produced `Phase1StateStore`,
`Phase1StateStoreError`, `getDefaultPhase1StateStorePath` — the planning label
leaked into permanent identifiers. AGENTS.md now forbids this, but AGENTS.md
only governs work in *this* repo. When jarvis runs patch mode against other
target repos, nothing carries the rule. It belongs in the prompt engine as a
global code-craft fragment, alongside `global.terse` and `global.documentation`.

## Decisions

- Add a new global fragment `prompts/global/naming.md`, id `global.naming`,
  mirroring the existing `global.terse` / `global.documentation` shape
  (frontmatter: id, behavior `agent-facing`, kind `fragment`, revision `1`).
- Body states the rule tersely: planning labels (phase/milestone/slice) are
  sequencing artifacts; never put them in identifiers, filenames, types, or
  public API; a spec titled "Phase 1 <thing>" names the <thing>.
- Register it in `v1/src/prompts/registry.ts` `PROMPT_ARTIFACT_FILES`.
- Wire it into patch mode's globals in `v1/src/modes/patch/prompt.ts`
  (`globalFragmentIds`). Patch mode is where target-repo code gets written.
- Scope to patch mode only. Plan mode drafts specs (where the label originates),
  not code; do not wire `global.naming` into plan prompts.
- Adding a global fragment changes the rendered patch prompt, which is
  snapshot-governed. Bump `patch.prompt.body` revision and regenerate the
  rendered-prompt fixtures per the prompt-governance standard.

## Tasks

- [x] Create `prompts/global/naming.md` with the fragment frontmatter and body.
- [x] Register the new path in `v1/src/prompts/registry.ts`.
- [x] Add `global.naming` to `globalFragmentIds` in `v1/src/modes/patch/prompt.ts`.
- [x] Bump `patch.prompt.body` revision and regenerate the shared + wrapper
  rendered-prompt fixtures under `v1/test/fixtures/prompts/rendered/`.
- [x] Update revision assertions in `v1/test/prompts/rendered-snapshots.test.ts`.
- [x] Run `bun run typecheck` and `bun test`.

## Acceptance criteria

- [x] `prompts/global/naming.md` exists with id `global.naming` and loads via the
  prompt registry.
- [x] The rendered patch prompt includes the naming rule text.
- [x] Plan-mode rendered prompts do not include the naming fragment.
- [x] Rendered-prompt snapshot tests pass against regenerated, revision-keyed
  fixtures.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- If `v1/docs/prompt-governance.md` or `v2/docs/prompts.md` enumerate the global
  fragment set, add `global.naming` there. No new standalone doc.
