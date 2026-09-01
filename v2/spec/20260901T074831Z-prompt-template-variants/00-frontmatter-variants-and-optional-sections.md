# Frontmatter variants and optionalSections

**Implement scope:** this subspec supersedes `intent.md` for tasks, acceptance criteria, and documentation updates in this slice.

## Problem

`PromptMetadata` and `readPromptArtifact` only model placeholders and fragment wiring. Callers cannot declare layout variants or optional prompt sections in artifact frontmatter, so `buildPlanDraftPrompt` and patch/review assembly patch rendered strings after the fact.

## Decisions

- Add `variants` and `optionalSections` to `PromptMetadata` in `shared/prompts/types.ts`; absent frontmatter keys default to `{}` and `[]` — rules out load failure for legacy prompts missing the new keys.
- Parse both keys from single-line JSON frontmatter values in `shared/prompts/registry.ts` — rules out a nested YAML parser in the registry.
- `variants` shape: `Record<variantId, Array<{ anchor: string; replacement: string; replaceAll?: boolean }>>` — rules out a flat global substitution list with no variant id.
- `optionalSections` shape: `Array<{ header: string; begin: string; end: string; placeholder: string }>` — rules out header-only omission without begin/end sentinels.
- Reject at load time when `variants` JSON is not a plain object, any variant id is empty, any variant entry is not an array, any substitution object lacks string `anchor`/`replacement` or has non-boolean `replaceAll`, or any key is not a string — rules out permissive parsing of structurally invalid variant metadata.
- Reject at load time when `optionalSections` JSON is not an array, any entry is not a plain object, or any entry lacks string `header`/`begin`/`end`/`placeholder` — rules out permissive parsing of structurally invalid section metadata.
- Each `optionalSections[].placeholder` must name a placeholder declared in the artifact `placeholders` frontmatter; undeclared bindings fail at load time in `readPromptArtifact` — rules out deferring binding validation to render time when omission has no defined value source.
- Pin reserved variant ids `flat-layout` and `nested-target-dir` in durable docs for plan-draft and plan-review spec-path substitution (`eliminate-prompt-string-surgery` consumer); do not add those entries to committed prompt artifacts in this spec — rules out coupling renderer land to call-site migration.
- Deferred to first consumer: whether `nested-target-dir` replacement text may reference caller-supplied placeholder tokens — pin when `eliminate-prompt-string-surgery` migrates `buildPlanDraftPrompt`.

## Tasks

- Extend `PromptMetadata` with `variants` and `optionalSections` types and fields.
- Parse and validate JSON frontmatter values in `readPromptArtifact`; reject malformed JSON and the structural reject conditions above at load time.
- Validate each `optionalSections[].placeholder` against declared `placeholders` at load time.
- Add registry fixture coverage for populated keys, absent keys, structural rejects, and undeclared optional-section placeholder bindings.

## Acceptance criteria

- [x] `shared/prompts/registry.test.ts` — fixture artifact with JSON `variants` and `optionalSections` frontmatter loads parsed metadata on `metadata.variants` and `metadata.optionalSections`; fails against the pre-fix registry that ignores the keys.
- [x] `shared/prompts/registry.test.ts` — malformed `variants` or `optionalSections` JSON fails at registry load time; fails against the pre-fix registry that never parses the keys.
- [x] `shared/prompts/registry.test.ts` — `variants` JSON with an empty variant id (e.g. `{ "": [{ "anchor": "X", "replacement": "Y" }] }`) fails at registry load time; fails against the pre-fix registry that never validates variant shape.
- [x] `shared/prompts/registry.test.ts` — `optionalSections` entry whose `placeholder` is not declared in artifact `placeholders` fails at registry load time; fails against the pre-fix registry that never validates optional-section bindings.

## Documentation updates

- None in this subspec; `02-prompts-doc-contract.md` owns the durable contract.
