# Render-time variant and optional-section resolution

**Implement scope:** this subspec supersedes `intent.md` for tasks, acceptance criteria, and documentation updates in this slice.

## Problem

`renderArtifactTemplate` only substitutes declared placeholders. Variant selection and optional-section omission live in ad-hoc `.replace` and `stripOptionalSection` helpers that silently no-op when prompt prose drifts.

## Decisions

- Resolve `variants` and `optionalSections` inside `renderArtifactTemplate` only — rules out post-render string surgery as the extension mechanism and rules out requiring every `renderTemplateWithDeclarations` caller to opt in.
- Add optional `options?: { variant?: string }` third argument to `renderArtifactTemplate` — rules out encoding the active variant in placeholder values.
- Omitted `options.variant` with populated `variants` is a no-op (no substitutions applied) — rules out implicit default variant selection.
- Resolution runs on whatever `artifact.body` is passed into `renderArtifactTemplate` (caller may supply assembled body, e.g. globals+step) — rules out limiting resolution to on-disk registry body only.
- Render pipeline order: apply selected variant anchor substitutions on `artifact.body`, remove optional sections whose bound placeholder is empty, then call `renderTemplateWithDeclarations` — rules out omitting sections after placeholder substitution (which would leave sentinel markers in output).
- Variant substitution entries apply in array order, sequentially on the evolving body — rules out unordered or parallel application.
- Omitted `replaceAll` substitutes the first `anchor` match only (non-global `String.prototype.replace` semantics) — rules out default global replacement.
- Optional-section excision when the bound placeholder is empty removes from the first `header` occurrence through the matching `end` inclusive, then consumes trailing `\n` characters (parity with `stripOptionalSection` in `shared/prompts/review-implement.ts`) — rules out leaving section tail newlines or stopping at `begin`.
- `header` marks excision start; `begin` and `end` are positional validators that must appear after `header` and before `end` respectively in the body — rules out treating `begin` as the removal start or skipping anchor validation.
- Empty optional-section placeholder omits when the bound value is `undefined`, `null`, `""`, or a whitespace-only string; non-string values use the same empty coercion as `renderTemplateWithDeclarations` (`typeof value === "string" ? value : ""`) before the whitespace test — rules out omitting only on `undefined` or treating `null` as non-empty.
- Unknown `options.variant` id throws `PromptRenderingError` with reason `unknown_variant` — rules out silent fallback to the unmodified body.
- Any variant `anchor` missing from the template body before substitution, and any `optionalSections` `header`/`begin`/`end` anchor missing from the body before omission, throws `PromptRenderingError` with reason `missing_template_anchor` — rules out silent no-op when prompt prose drifts (reachable on `shared/prompts/plan-draft.ts` and `shared/prompts/review-implement.ts` pre-fix `.replace` / `stripOptionalSection` paths).
- When a bound optional-section placeholder is non-empty, leave the section intact and render normally — rules out validating omission anchors only on the empty path.

## Tasks

- Extend `PromptRenderingError.reason` with `unknown_variant` and `missing_template_anchor`.
- Implement variant substitution (honor `replaceAll` default and sequential application) and optional-section removal per the excision contract in `renderArtifactTemplate`.
- Add regression tests in `shared/prompts/render.test.ts` for missing variant anchors, empty optional-section omission with surviving required content, unknown variant id, and `missing_template_anchor` on optional-section drift.

## Acceptance criteria

- [ ] `shared/prompts/render.test.ts` — declared variant referencing a missing template anchor throws `PromptRenderingError` with reason `missing_template_anchor` at render time; fails against the pre-fix silent no-op behavior.
- [ ] `shared/prompts/render.test.ts` — optional section with an empty bound placeholder value is omitted from rendered output while required sections still render; fails against the pre-fix path that always emits the section body.
- [ ] `shared/prompts/render.test.ts` — `options.variant` naming an id absent from artifact `variants` throws `PromptRenderingError` with reason `unknown_variant`; fails against the pre-fix renderer that has no variant selection.
- [ ] `shared/prompts/render.test.ts` — optional-section `header`, `begin`, or `end` anchor absent from the template body throws `PromptRenderingError` with reason `missing_template_anchor`; fails against the pre-fix `stripOptionalSection` silent no-op on drift (reachable on `shared/prompts/review-implement.ts`).

## Documentation updates

- None in this subspec; `02-prompts-doc-contract.md` owns the durable contract.
