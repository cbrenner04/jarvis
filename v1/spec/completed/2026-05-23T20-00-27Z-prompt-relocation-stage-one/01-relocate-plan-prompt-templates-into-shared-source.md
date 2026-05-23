# 01 — Relocate plan prompt templates into shared source

## Problem

Plan mode currently owns five prompt templates directly under
`v1/src/modes/plan/prompts/`. Stage one needs to move those template bytes into
the shared top-level `prompts/` tree without changing wording or disturbing the
per-loader rewrite behavior that already exists around committed-spec versus
flat-layout plan runs.

If this work is bundled together with broader prompt-system design, the result
will be hard to review and easy to regress: the important requirement here is
that template ownership moves while `refine.ts`, `draft.ts`, `review.ts`,
`name-only.ts`, and `inline-draft.ts` keep their current rendering contracts.

## Scope

Relocate the five existing plan prompt templates into plainly named shared
files under the repo-level `prompts/` tree, then update the current plan
loaders to read those new paths while preserving their existing rewrite and
rendering behavior. This slice must leave plan-template ownership complete on
its own: once it lands, the five template bodies should already have a single
editable source of truth.

This slice covers:

- `v1/src/modes/plan/prompts/refine.md`
- `v1/src/modes/plan/prompts/name-only.md`
- `v1/src/modes/plan/prompts/draft.md`
- `v1/src/modes/plan/prompts/review.md`
- `v1/src/modes/plan/prompts/inline-draft.md`

This slice does not cover prompt-template wording changes, new template
metadata, registry lookup by ID, recursive rendering changes, or broader plan
mode behavior changes.

## Primary sources

- `v1/src/modes/plan/refine.ts`
- `v1/src/modes/plan/name-only.ts`
- `v1/src/modes/plan/draft.ts`
- `v1/src/modes/plan/review.ts`
- `v1/src/modes/plan/inline-draft.ts`
- `v1/src/modes/plan/prompts/`
- `v1/docs/plan-mode.md`
- `v2/spec/prompts.md`

## Task checklist

- [ ] Create one shared prompt source file under the repo-level `prompts/`
      tree for each of the five current plan templates rather than collapsing
      them into a registry, manifest, or generated bundle.
- [ ] Move each template verbatim into the shared prompt tree with no wording
      changes.
- [ ] Update the plan loaders so v1 reads the shared template files while
      preserving the current split of responsibilities between template bytes
      and TypeScript rendering logic.
- [ ] Preserve the current rewrite behavior exactly:
      repo-backed `refine` rewrites `spec/<NAME>/` to the configured
      `targetDir`; `draft` and `review` keep their distinct committed-spec and
      flat-layout rewrite modes; `name-only` and `inline-draft` remain simple
      template renderers.
- [ ] Keep the existing non-recursive rendering contract unchanged. This
      relocation must not alter how placeholder-looking user content is treated
      during template rendering.
- [ ] Remove or replace the old v1 prompt-template homes so they do not remain
      a second editable prompt home after the extraction.
- [ ] Keep the resulting tree easy to audit:
      the five shared template files are the only editable template bodies,
      while the `v1/src/modes/plan/*.ts` files remain loaders/renderers.
- [ ] Keep the destination layout aligned with the shared prompt ownership
      chosen in `v2/spec/prompts.md`; this slice should populate that
      `prompts/` tree, not reopen the location decision.
- [ ] Update plan prompt tests so the rendered refine, name-only, draft,
      review, and inline-draft prompt texts remain identical after the path
      change.

## Acceptance criteria

- [x] The five current plan templates exist as first-class shared prompt
      artifacts under the top-level `prompts/` tree in a one-file-per-template
      mapping.
- [x] `v1/src/modes/plan/prompts/` no longer remains a second editable home for
      those five template bodies.
- [x] Loader behavior is unchanged apart from the source path:
      existing `targetDir` rewrites, flat-layout rewrites, and non-recursive
      rendering still behave exactly as they do today.
- [x] Rendered prompt text for refine, name-only, draft, review, and
      inline-draft stays identical after relocation.
- [x] No registry, metadata, revision, or new composition semantics are
      introduced for the plan templates in this slice.
- [x] Automated coverage exists for the unchanged rendered plan prompt output.

## Documentation updates

- [ ] Update plan-prompt location references touched by this slice so they
      identify the shared `prompts/` source as the template home and describe
      the remaining `v1/src/modes/plan/*.ts` files as loaders/renderers.
