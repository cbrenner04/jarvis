# 01 — Rendering contract, prompt IDs, revisions, and snapshots

## Problem

Once the design names the prompt surfaces and their ownership boundaries, it
still needs a narrow but concrete runtime contract for how shared prompt
artifacts are identified, rendered, versioned, and tested. The intent is
specific here: stable prompt IDs must not depend on file paths, prompt
revisions must make shared behavior changes visible in review without frozen
copies, and initial testing should protect deterministic renderer behavior
rather than broad eval outcomes.

This slice should turn those requirements into a conservative first
implementation contract that future extraction and renderer work can build
against.

## Scope

Extend `v2/spec/prompts.md` with the design decisions for:

- the shared `prompts/` directory layout and metadata shape
- stable prompt IDs and runtime lookup by ID
- revision signals tied to those IDs
- the narrow rendering contract and override model
- review and rendered-snapshot expectations for shared prompts and adapter-local
  wrappers
- the concrete location and naming scheme for revision-aware rendered snapshots

This slice should not author the follow-on implementation intents themselves;
subspec 02 owns that planning and final migration sequencing.

## Primary sources

- `v2/spec/prompts.md`
- `v2/spec/v2-vision.md`
- `v2/spec/wip-v2-musings.md`
- `v1/src/modes/plan/template-renderer.ts`
- `v1/src/modes/patch/prompt.ts`
- `v1/src/agents/codex.ts`
- `v1/src/modes/plan/prompts/`

## Task checklist

- [ ] Add the recommended top-level `prompts/` layout to `v2/spec/prompts.md`,
      organized by the v2 behavior vocabulary (`write`, `review-and-update`,
      `human`) rather than the legacy mode split, while keeping the structure
      conservative enough to support current v1 artifacts immediately.
- [ ] Pick one concrete metadata mechanism for prompt artifacts and fragments,
      such as leading frontmatter, and require at least:
      stable `id`, behavior, step-or-fragment kind, and revision signal.
- [ ] Require the design to use one vocabulary consistently for renderable
      units, such as `step` and `fragment`, so runtime lookup, metadata, and
      snapshot keys do not mix alternate names for the same concept.
- [ ] Include one concrete metadata example in the design so later extraction
      work does not need to invent the schema. The example should make clear
      that runtime binding keys off `id` alone and treats file paths as
      organizational detail.
- [ ] Specify that runtime binding is by prompt ID only, not by path, and that
      duplicate IDs, missing IDs, and references to unknown IDs are hard
      validation failures.
- [ ] Define the versioning/revision rule:
      wording changes or fragment-set changes bump the affected prompt's
      revision signal, while pure file moves or comment-only metadata changes do
      not; rendered snapshots record prompt ID plus revision.
- [ ] Describe the narrow rendering contract for the first implementation:
      prompt source owns ordered fragments, task text, delimiters, placeholder
      declarations, and explicit add/remove fragment overrides; renderer code
      owns placeholder substitution, validation, non-recursive rendering,
      delimiter insertion, and adapter-wrapper selection.
- [ ] Specify the default layering order
      (global fragments -> behavior fragments -> step body) and the explicit
      override semantics for adding or removing fragments when a step is the
      exception.
- [ ] Define placeholder and delimiter rules, including typed/declared
      placeholders, validation failures for missing values, preservation of
      injected user content as data, and prompt-injection protections expressed
      through delimiters plus renderer invariants instead of template logic.
- [ ] State the allowed boundary for adapter-specific wrapping:
      step identity and core instruction text remain shared prompt artifacts,
      while unavoidable CLI-specific wrappers stay thin, separately classified,
      minimized, and snapshot-covered.
- [ ] State explicitly that the first implementation does not pull interactive
      CLI chooser or confirmation strings into the prompt registry contract;
      those remain cataloged surfaces from subspec 00, but the registry and
      snapshot rules in this slice apply to shared agent-bound artifacts and
      adapter-local wrappers.
- [ ] Author the initial rendered-snapshot testing standard, covering at least:
      layering order, add/remove overrides, placeholder validation failures,
      non-recursive substitution, delimiter preservation for injected user
      content, and wrapper selection for any unavoidable adapter-local layer.
- [ ] State where revision-aware rendered snapshots live and how they are keyed
      so later implementation work can make changes reviewable without inventing
      a second artifact model. The design should describe snapshots in terms of
      prompt ID plus revision, not file path.
- [ ] Require one concrete snapshot path example in the design, including how
      shared step snapshots and adapter-local wrapper snapshots are
      distinguished without making file paths part of the stable runtime
      binding.
- [ ] Record that prompt renderer tests for future v2 source follow the v2
      co-location rule and live next to renderer/registry code rather than
      under a parallel `v2/test/` tree.

## Acceptance criteria

- [x] `v2/spec/prompts.md` specifies a concrete shared `prompts/` layout tied to
      the v2 behavior vocabulary and suitable for both `jarvis1` and v2.
- [x] The design requires first-class prompt metadata with stable IDs,
      revision signals, and runtime lookup by ID rather than by file path.
- [x] The document defines hard validation failures for duplicate IDs, missing
      IDs, and unknown prompt references.
- [x] The rendering contract clearly separates what lives in prompt source from
      what remains in renderer/runtime code, with non-recursive substitution and
      wrapper selection explicitly assigned to code.
- [x] The design explicitly excludes human-facing CLI chooser and confirmation
      strings from the first prompt-registry contract even though they remain
      part of the broader prompt-surface taxonomy.
- [x] The versioning strategy makes behavior-affecting shared prompt changes
      visible in review without introducing frozen prompt copies.
- [x] The review/testing section defines deterministic rendered-snapshot
      coverage for renderer correctness and adapter-local wrappers, not just the
      happy-path rendered text.
- [x] The design includes one concrete metadata example and a concrete snapshot
      keying rule based on prompt ID plus revision.

## Documentation updates

- [ ] Extend `v2/spec/prompts.md` with the layout, ID, revision, rendering, and
      snapshot-testing sections owned by this subspec.
