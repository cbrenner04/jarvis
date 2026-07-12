# 00 - Shared plan-draft prompt builder, v1 delegates

Suffix assembly for `plan.prompt.draft` lives only in v1 (`v1/src/modes/plan/draft.ts:buildDraftPrompt`), and v2 re-renders the artifact independently. Extract a shared builder (`shared/prompts/plan-draft.ts`, mirroring `shared/prompts/intent-split.ts`) that owns registry assembly, delimiter policy, spec-layout rewrites, and the optional runtime suffixes; make v1 `buildDraftPrompt` a delegate. v1 output must stay byte-identical (v1 plan mode invokes the agent directly, no write loop, so it requests neither suffix).

## Decisions

- Runtime suffixes are appended by the builder, outside the registry artifact — rules out bumping `prompts/plan/draft.md` revision to bake in staging paths or terminal tokens.
- Each suffix section is emitted only when its input is supplied (`specDir` → `## File output`; `stepRules` → `## Step completion`) — rules out always-on suffixes, which would change v1's rendered prompt.
- v1 `buildDraftPrompt` keeps its exported signature and delegates — rules out rewriting v1 call sites.
- Spec-dir naming stays in the rendered `SPEC_GUIDANCE` plus the existing `spec/<NAME>/` → `<targetDir>/<NAME>/` rewrite, which moves into the builder — rules out a separate timestamp/naming instruction block.
- Builder renders via `shared/prompts/render.ts` declarations (as `intent-split.ts` does) — rules out keeping v1's `template-renderer.ts` path in shared code.

## Task checklist

- [ ] Add `shared/prompts/plan-draft.ts` exporting `PLAN_DRAFT_PROMPT_ID` and `buildPlanDraftPrompt({ name, intent, specGuidance, workDirLabel?, targetDir?, flatSpecLayout?, specDir?, stepRules? })`.
- [ ] Move registry assembly, delimiter enforcement, layout rewrite, and rendering out of `v1/src/modes/plan/draft.ts` into the builder; `buildDraftPrompt` delegates.
- [ ] Co-locate `shared/prompts/plan-draft.test.ts`.

## Acceptance criteria

- [ ] `v1/test/prompts/rendered-snapshots.test.ts` and `v1/test/modes/plan/prompts.test.ts` stay green with no snapshot edits (v1 rendered prompt unchanged by the extraction).
- [ ] `v1/test/plan-draft-hard-error-continue.test.ts` and `v1/test/plan-draft-additional-read-dirs.test.ts` stay green.
- [ ] `shared/prompts/plan-draft.test.ts` asserts: omitting `specDir` and `stepRules` yields no `## File output` / `## Step completion` sections; supplying them appends those sections; `flatSpecLayout` and `targetDir` rewrites match v1's current behavior; a delimiter-violating `intent` or `specGuidance` throws.
- [ ] `shared/**` still imports nothing from `v1/**` or `v2/**`.

## Documentation updates

- None. Internal extraction with no operator-facing or behavioral change; v2 wiring and its docs land in `01`.
