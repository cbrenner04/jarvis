---
name: prompt-relocation-stage-one
---

Relocation-only extraction of current v1 prompt artifacts into shared prompt
source.

This intent performs a pure move of prompt-owned text from current v1 locations
to shared prompt source, without changing wording or introducing new composition
semantics. It is the first migration stage from `v2/spec/prompts.md`.

Scope:

- Extract `v1/src/modes/patch/rules.md` into shared prompt source verbatim.
- Extract stable prompt text currently assembled in
  `v1/src/modes/patch/prompt.ts` into shared prompt artifacts while preserving
  existing runtime conditional assembly behavior.
- Extract plan prompt templates verbatim:
  - `v1/src/modes/plan/prompts/refine.md`
  - `v1/src/modes/plan/prompts/name-only.md`
  - `v1/src/modes/plan/prompts/draft.md`
  - `v1/src/modes/plan/prompts/review.md`
  - `v1/src/modes/plan/prompts/inline-draft.md`
- Update v1/v2 loading call sites only as needed to read extracted shared
  artifacts without behavior changes.

Out of scope:

- Prompt wording edits.
- New fragment layering/composition behavior.
- Registry validation expansion (duplicate/missing/unknown IDs).
- Revision-aware rendered snapshot infrastructure beyond existing checks.
- Human chooser/confirmation prompt relocation.
- Adapter-wrapper redesign.

## Acceptance criteria

- [ ] All listed prompt artifacts are relocated to shared prompt source with
      no wording changes.
- [ ] `v1/src/modes/patch/rules.md`, patch stable prompt text from
      `v1/src/modes/patch/prompt.ts`, and all five plan prompt templates are
      explicitly covered by implementation scope.
- [ ] Runtime behavior for patch and plan prompt assembly remains unchanged
      aside from reading prompt text from shared source.
- [ ] No new prompt composition semantics are introduced in this extraction
      pass.
- [ ] The implementation tree is auditable as relocation-only (move/source-path
      changes clearly separable from any rendering logic work).

## Documentation updates

- [ ] Update prompt-location and ownership docs to reflect extracted paths and
      confirm relocation-only posture.

## Refine turn 1

- Keep the extraction boundary mechanical. The moved artifacts should be only: `v1/src/modes/patch/rules.md`, the five files under `v1/src/modes/plan/prompts/`, and the stable literal instruction lines currently assembled in `v1/src/modes/patch/prompt.ts`. Runtime-only logic such as `specPath` interpolation, sibling-directory bullet generation, conditional inclusion of the sibling block, and final line joining should remain in TypeScript.
- Treat this pass as path/source-of-truth migration, not prompt-system design. It should not introduce prompt IDs, frontmatter metadata, registry validation, rendered snapshot revisions, or fragment layering. If any of those seem necessary, they belong in the later renderer/snapshot pass rather than this spec.
- The implementation should preserve the current patch prompt byte-for-byte after render, including trimming behavior around `rules.md` and newline placement from `buildPrompt()`. The same applies to plan prompts: loaders may change source paths, but the rendered prompt text for refine, name-only, draft, review, and inline-draft should stay identical.
- Auditable relocation likely means keeping the moved text in plainly named shared prompt files and minimizing mixed logic changes around it. Drafting should bias toward a diff where reviewers can separate "artifact moved here unchanged" from "loader now reads new path" without having to infer behavior from broad refactors.
- The docs update should at least cover the places that currently describe prompt ownership and locations from the v1 side: `v1/docs/agents.md` and `v1/docs/run-loop.md`. If the shared-source location lives under `v2`, the documentation should state clearly that v1 now reads prompt artifacts from that shared location while preserving current behavior.

## Refine turn 2

- Keep the shared destination concrete and file-shaped. The draft should choose plainly named prompt source files under the shared prompt tree and map each current v1 artifact to one extracted file rather than collapsing several prompts into a registry, manifest, or generated bundle in this pass.
- The patch prompt extraction boundary is narrower than the whole `buildPrompt()` function. What moves out of `v1/src/modes/patch/prompt.ts` is only the stable literal text segments now hardcoded there; `readFileSync`/path resolution, sibling-list iteration, `specPath` interpolation, the conditional sibling block wrapper, and `lines.join("\\n")` should remain in code so the relocation diff stays mechanically reviewable.
- The plan-mode loaders already do light path rewriting before template rendering: committed-spec runs replace `spec/<NAME>/` with the configured target dir, draft/review flat-layout mode rewrites a couple of path sentences, and refine/name-only/inline-draft feed template variables into the existing non-recursive renderer. This intent should preserve that split. Moving the template bytes is in scope; redesigning those rewrite hooks or the renderer contract is not.
- Auditable relocation should include an obvious before/after ownership story for the old v1 prompt paths. Whether the legacy files are deleted or turned into thin readers, the final tree should avoid leaving two editable copies of the same prompt text in place at once.
- Documentation should call out the exact categories now sourced from the shared prompt location: patch rules, patch stable instruction text, and the five plan prompt templates. It should also be explicit that interactive/operator prompts such as repository disambiguation remain outside this migration.

## Refine turn 3

- Preserve the current per-loader rewrite behavior exactly when switching sources. In repo-backed refine runs, `refine.ts` only rewrites `spec/<NAME>/` to the configured `targetDir` before template rendering. `draft.ts` and `review.ts` each have two distinct modes that should stay as-is: committed-spec mode rewrites `spec/<NAME>/` to `targetDir`, while flat-layout mode rewrites specific path text such as `spec/<NAME>/intent.md` and, for draft, the "`Only write files under ...`" sentence. `name-only.ts` and `inline-draft.ts` do not have those path rewrites and should remain simple template renderers.
- The relocation should treat each currently loaded file as a first-class shared artifact, not as material to be merged opportunistically. In concrete terms, the draft should account for seven shared prompt files that v1 reads directly or indirectly: patch rules, patch stable instruction text, and the five existing plan templates. Keeping that one-artifact-per-file mapping will make reviewable "moved unchanged" diffs much clearer.
- The current docs mention prompt locations in more than the two obvious v1 pages. `v1/docs/agents.md` and `v1/docs/run-loop.md` are minimum scope, but `v1/docs/plan-mode.md` also names specific prompt-template paths and should be updated if those references would otherwise point at dead v1-owned files. The wording should distinguish "v1 runtime logic still lives in `v1/src/...`" from "prompt text source of truth now lives in the shared prompt tree."
- The draft should avoid introducing compatibility shims that become a second editable prompt home. Thin TypeScript loaders that read the new shared path are fine; leaving user-editable markdown prompt bodies in both the old v1 tree and the new shared tree is not. Reviewers should be able to tell which files are still executable loader code versus which files are the sole prompt text artifacts.
