# 00 - Registry metadata and load validation

## Problem

The relocation-only extraction pass moves prompt source out of ad hoc v1 files,
but this stage still needs a stable way to identify prompts independent of file
paths. Today the prompt surfaces are a mix of Markdown files and TypeScript
builders with no shared registry contract, so there is no single place to
enforce required metadata, reject duplicate IDs, or catch bad fragment/override
references before runtime.

This subspec establishes the metadata-first registry boundary. Runtime code must
bind prompts by stable ID only, while file paths remain an organizational
detail. Registry failures need to be deterministic and early so later renderer
and snapshot work can assume a valid loaded prompt graph.

## Decisions

- The first registry rollout covers agent-facing prompt artifacts that shape an
  agent run or plan-spec generation:
  - the patch prompt body rooted in `v1/src/modes/patch/prompt.ts`,
  - injected patch rules from `v1/src/modes/patch/rules.md`,
  - plan draft/review/refine prompt files under `v1/src/modes/plan/prompts/`.
- The first rollout does not include human-facing chooser or confirmation text
  such as `v1/src/disambiguation-prompt.ts`, and it does not need to include
  adjacent authoring helpers like `name-only.md` or `inline-draft.md` unless
  implementation proves they must share the same registry contract. If they stay
  out, document that boundary explicitly.
- Every registered prompt artifact uses leading frontmatter with required
  metadata fields `id`, `behavior`, `kind`, and `revision`. Stable lookup keys
  are the `id` values only; `revision` participates in snapshots and change
  visibility, not runtime addressing.
- Registry-load validation is strict and eager. Duplicate IDs, missing required
  metadata, unknown fragment membership references, and unknown explicit
  override targets must all fail during registry construction before any render
  attempt.
- This subspec may introduce the registry types, loaders, validation helpers,
  and fixture structure needed by later renderer work, but it must not broaden
  prompt wording or change runtime rendering semantics yet.

## Task checklist

- [ ] Define the first shared prompt artifact metadata shape and which prompt
      source files participate in this rollout.
- [ ] Implement registry loading that resolves prompt artifacts by stable ID
      rather than by source path.
- [ ] Add hard validation for duplicate IDs and missing required metadata during
      registry load.
- [ ] Add hard validation for unknown referenced IDs in fragment membership or
      explicit override metadata during registry load.
- [ ] Add deterministic tests that cover successful ID-based registration and
      the registry-load failure paths.

## Acceptance criteria

- [x] Registry APIs exposed to runtime code resolve the included prompt
      artifacts by stable prompt ID, with no lazy path-based fallback in the
      load or lookup path.
- [x] Missing `id`, `behavior`, `kind`, or `revision` metadata is reported as a
      hard registry-load error naming the offending artifact.
- [x] Duplicate prompt IDs are reported as a hard registry-load error before
      any render attempt.
- [x] Unknown fragment membership references and unknown explicit override
      targets are reported as hard registry-load errors before any render
      attempt.
- [x] Tests prove the validation phase boundary: a valid loaded registry is a
      prerequisite for render-time behavior tests, and load failures do not
      depend on a specific prompt build or step invocation.
- [x] The rollout boundary is documented in-code or in the spec comments so
      reviewers can see which prompt surfaces are intentionally included now and
      which are deferred.

## Documentation updates

- [x] Update the prompt-governance design/docs to record the first registry
      surface area, the required metadata fields, and the rule that registry
      validation fails during load rather than during render.
- [x] Update the relevant v1 developer docs for prompt maintenance so path
      location is treated as organizational detail and stable IDs are the
      supported runtime lookup contract.

## Out of scope

- Prompt wording rewrites.
- Expanding the first registry contract to human-facing CLI chooser text.
- Making adapter-local wrappers part of the shared prompt identity.
