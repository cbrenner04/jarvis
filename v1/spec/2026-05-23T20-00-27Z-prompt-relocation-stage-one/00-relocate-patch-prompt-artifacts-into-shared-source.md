# 00 — Relocate patch prompt artifacts into shared source

## Problem

Patch mode currently splits its prompt across two v1-owned locations:
`v1/src/modes/patch/rules.md` and the stable literal instruction lines inside
`v1/src/modes/patch/prompt.ts`. Stage one needs to move only the prompt-owned
text into the shared top-level `prompts/` tree while preserving the existing
`buildPrompt()` runtime behavior byte-for-byte, including trimming and newline
placement.

Without an explicit patch-focused slice, it is easy to over-migrate the whole
builder, blur runtime-owned formatting into the extracted source, or mix this
mechanical move with later renderer work that belongs to a different spec.
It is also easy to miss non-patch-mode readers of the relocated text, notably
`v1/src/review-feedback.ts`, which currently reads the same patch rules file.

## Scope

Move the two patch-owned prompt artifacts into plainly named files under the
shared top-level `prompts/` tree, then update every current reader of those
artifacts to load them from that shared source without changing behavior. This
slice must leave patch prompt ownership complete on its own: once it lands, the
relocated patch artifacts should already have a single editable source of
truth.

This slice covers:

- relocation of `v1/src/modes/patch/rules.md` verbatim into the shared
  `prompts/` tree
- relocation of only the stable literal instruction text currently assembled in
  `v1/src/modes/patch/prompt.ts`
- the narrow loader/path updates needed for `v1/src/modes/patch/prompt.ts` and
  `v1/src/review-feedback.ts` to read the relocated text
- tests that prove rendered patch prompt output stays unchanged

This slice does not cover the plan templates, prompt IDs, metadata, registry
validation, rendered snapshot revisions, or any redesign of patch prompt
composition.

## Primary sources

- `v1/src/modes/patch/prompt.ts`
- `v1/src/modes/patch/rules.md`
- `v1/src/review-feedback.ts`
- `v1/docs/run-loop.md`
- `v2/spec/prompts.md`

## Task checklist

- [ ] Create the shared patch prompt source files under the repo-level
      `prompts/` tree. The mapping must remain one artifact per file:
      one file for patch rules and one file for the stable patch instruction
      text.
- [ ] Move the contents of `v1/src/modes/patch/rules.md` into the shared patch
      rules file with no wording changes.
- [ ] Extract only the stable literal instruction segments from
      `v1/src/modes/patch/prompt.ts` into a shared patch prompt text file.
- [ ] Keep all runtime-owned behavior in TypeScript:
      `specPath` interpolation, sibling-directory bullet generation,
      conditional inclusion of the sibling block, `jarvisRules()` loading, and
      final line joining.
- [ ] Update patch prompt loading to read the relocated files from the shared
      prompt source while preserving the current `trim()` behavior around the
      rules text.
- [ ] Update every other current reader of the relocated patch artifacts,
      including `v1/src/review-feedback.ts`, so the old v1 markdown path does
      not remain a required runtime dependency after the move.
- [ ] Remove or replace the old patch prompt-text homes so they are no longer
      editable prompt sources after the move.
- [ ] Keep the resulting tree easy to audit:
      there must be one editable source of truth for the patch rules and one
      editable source of truth for the stable patch instruction text, while
      runtime loader logic remains in TypeScript.
- [ ] Extend or update patch prompt tests so they protect byte-for-byte output
      equivalence for runs with and without sibling directories.
- [ ] Keep the implementation diff narrow enough that reviewers can separate
      "prompt text moved unchanged" from "loader now reads new path."

## Acceptance criteria

- [x] The top-level `prompts/` tree contains two first-class patch artifacts:
      the relocated rules text and the relocated stable patch instruction text.
- [x] `v1/src/modes/patch/rules.md` is no longer a second editable home for the
      patch rules text.
- [x] `v1/src/modes/patch/prompt.ts` retains runtime assembly behavior and no
      longer embeds the stable literal instruction text directly.
- [x] Every current v1 reader of the relocated patch artifacts, including
      `v1/src/review-feedback.ts`, loads them from the shared source rather
      than depending on the legacy v1 markdown path.
- [x] The rendered patch prompt remains byte-for-byte identical before and
      after relocation, including `rules.md` trimming, sibling-block placement,
      and newline joining.
- [x] No prompt registry, ID, metadata, revision, or fragment-layering
      semantics are introduced by this slice.
- [x] Automated coverage exists for the unchanged rendered patch prompt output.

## Documentation updates

- [ ] Update any patch-prompt path references touched by this slice so they
      point at the shared `prompts/` source location instead of implying that
      patch prompt text still lives entirely under `v1/src/modes/patch/`.
