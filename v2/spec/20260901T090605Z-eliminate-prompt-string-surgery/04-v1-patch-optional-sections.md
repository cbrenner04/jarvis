# v1 patch optional sections

`buildPrompt` in `v1/src/modes/patch/prompt.ts` omits empty optional blocks via local `stripOptionalPromptSection`, then applies assembled-string `.replace` for newline spacing before `Follow these Jarvis rules:`.

## Decisions

- Route v1 patch assembly through `renderArtifactTemplate` on `patch.prompt.body`, consuming the `optionalSections` frontmatter landed in subspec 01 — rules out local `stripOptionalPromptSection` and post-render `.replace` in `prompt.ts`.
- Bind optional-section omission to `renderArtifactTemplate` trim-based emptiness for `repoGuidance`, `activeSubspecPath`, and `timeoutCheckpointContext` (same placeholder sources as today) — rules out v1 `content.length === 0` strict emptiness retained via call-site bridging.
- Delete `stripOptionalPromptSection` from `v1/src/modes/patch/prompt.ts` once migrated — rules out retaining a v1-only excision helper.

## Tasks

- Replace `renderTemplateWithDeclarations` + manual excision loop in `buildPrompt` with `renderArtifactTemplate`.
- Remove `stripOptionalPromptSection` and the assembled-string `.replace` newline patch.

## Acceptance criteria

- [ ] `v1/test/prompt.test.ts` stays green.
- [ ] `v1/test/prompt.test.ts` — whitespace-only `repoGuidance` omits `## Repo Guidance`; fails against pre-fix `stripOptionalPromptSection` (length-only check) and passes after `renderArtifactTemplate` migration.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` stays green after snapshot refresh for trim-based optional-section omission.

## Documentation updates

- `v2/docs/v1-behaviors.md` — patch `buildPrompt` optional-section omission uses trim-based emptiness (whitespace-only `repoGuidance`, `activeSubspecPath`, and `timeoutCheckpointContext` omit their sections).
