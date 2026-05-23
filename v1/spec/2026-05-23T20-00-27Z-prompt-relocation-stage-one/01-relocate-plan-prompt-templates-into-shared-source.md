# 01 — Relocate plan prompt templates into shared source

## Problem

Plan mode currently owns five prompt templates directly under
`v1/src/modes/plan/prompts/`. Stage one needs to move those template bytes into
a shared prompt source tree without changing wording or disturbing the
per-loader rewrite behavior that already exists around committed-spec versus
flat-layout plan runs.

If this work is bundled together with broader prompt-system design, the result
will be hard to review and easy to regress: the important requirement here is
that template ownership moves while `refine.ts`, `draft.ts`, `review.ts`,
`name-only.ts`, and `inline-draft.ts` keep their current rendering contracts.

## Scope

Relocate the five existing plan prompt templates into plainly named shared
files, then update the current plan loaders to read those new paths while
preserving their existing rewrite and rendering behavior.

This slice covers:

- `v1/src/modes/plan/prompts/refine.md`
- `v1/src/modes/plan/prompts/name-only.md`
- `v1/src/modes/plan/prompts/draft.md`
- `v1/src/modes/plan/prompts/review.md`
- `v1/src/modes/plan/prompts/inline-draft.md`

This slice does not cover prompt-template wording changes, new template
metadata, registry lookup by ID, recursive rendering changes, or broader plan
mode behavior changes.

## Task checklist

- [ ] Create one shared prompt source file for each of the five current plan
      templates rather than collapsing them into a registry, manifest, or
      generated bundle.
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
- [ ] Remove or convert the old v1 prompt-template files so they do not remain
      a second editable prompt home after the extraction.
- [ ] Update plan prompt tests so the rendered refine, name-only, draft,
      review, and inline-draft prompt texts remain identical after the path
      change.

## Acceptance criteria

- [ ] The five current plan templates exist as first-class shared prompt
      artifacts in a one-file-per-template mapping.
- [ ] `v1/src/modes/plan/prompts/` no longer remains a second editable home for
      those five template bodies.
- [ ] Loader behavior is unchanged apart from the source path:
      existing `targetDir` rewrites, flat-layout rewrites, and non-recursive
      rendering still behave exactly as they do today.
- [ ] Rendered prompt text for refine, name-only, draft, review, and
      inline-draft stays identical after relocation.
- [ ] No registry, metadata, revision, or new composition semantics are
      introduced for the plan templates in this slice.
- [ ] Automated coverage exists for the unchanged rendered plan prompt output.

## Documentation updates

- [ ] Update any plan-prompt location references touched by this slice so they
      identify the shared prompt source as the template home and describe the
      remaining `v1/src/modes/plan/*.ts` files as loaders/renderers.
