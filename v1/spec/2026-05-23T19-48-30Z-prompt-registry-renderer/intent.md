---
name: prompt-registry-renderer
---

Prompt registry, renderer contract, revision signals, and deterministic
rendered snapshots.

This intent is the second migration stage from `v2/spec/prompts.md`. It
introduces ID-based lookup/validation, revision-aware snapshot coverage, and
the first shared rendering contract after relocation-only extraction lands.

Scope:

- Implement prompt registry lookup by stable prompt ID.
- Enforce hard validation failures for:
  - duplicate IDs,
  - missing required metadata (`id`, `behavior`, `kind`, `revision`),
  - unknown referenced IDs in fragment/override references.
- Implement renderer contract rules:
  - deterministic ordering (`global -> behavior -> step`),
  - explicit override handling (`add`/`remove`),
  - placeholder declaration/type/required validation,
  - delimiter policy enforcement for injected user data,
  - non-recursive substitution,
  - adapter-wrapper selection boundary.
- Add revision-aware rendered snapshots keyed by ID + revision for step and
  wrapper variants.
- Add deterministic tests for ordering, overrides, placeholders, delimiters,
  non-recursive substitution, wrapper selection, and ID-validation failures.

Out of scope:

- Prompt wording rewrites.
- Layered composition expansion beyond the contract already documented in
  `v2/spec/prompts.md`.
- Broader eval infrastructure beyond deterministic rendered snapshots.

## Acceptance criteria

- [ ] Registry and renderer resolve prompt artifacts by stable ID (not path).
- [ ] Duplicate IDs, missing required metadata, and unknown referenced IDs fail
      as hard validation errors.
- [ ] Rendered snapshot outputs are keyed by prompt ID and revision, with
      deterministic coverage for both shared step render and adapter wrapper
      variants.
- [ ] Tests cover ordering, explicit overrides, placeholder validation,
      delimiter preservation, non-recursive substitution, wrapper selection,
      and ID-validation failures.
- [ ] Changes are implementation-atomic relative to relocation extraction
      (registry/renderer/snapshot logic is reviewable independently).

## Documentation updates

- [ ] Update prompt governance and developer docs with registry validation
      rules, snapshot keying by ID/revision, and renderer contract invariants.

## Refine turn 1

- Keep this stage mechanically separate from the prior relocation-only
  extraction pass. The implementation should assume prompt source files already
  moved without wording changes, then layer registry lookup, validation,
  rendering contract enforcement, and snapshot keying on top. Do not combine
  file moves or prompt rewrites with this stage.
- Treat the registry contract as metadata-first and path-agnostic. A
  conservative binding shape is leading frontmatter per artifact with required
  `id`, `behavior`, `kind`, and `revision`; runtime lookup should bind by `id`
  only, while file paths remain organizational detail. Validation should fail
  during registry load, not lazily during render, for duplicate IDs, missing
  required metadata, and unknown referenced IDs.
- Keep the first renderer contract narrow. Prompt source should own ordered
  fragment membership, step task text, declared placeholders, explicit
  `add`/`remove` overrides, and user-data delimiter markers. Renderer/runtime
  code should own deterministic assembly order, placeholder presence/type
  validation, delimiter insertion/enforcement, non-recursive substitution, and
  adapter-wrapper selection. Avoid introducing template-level conditional logic
  that belongs in TypeScript.
- Snapshot scope should distinguish shared step renders from adapter-local
  wrappers without making wrappers part of the stable prompt identity. A useful
  review boundary is: shared step snapshots key by prompt `id` + `revision`,
  while wrapper snapshots record the same shared prompt identity plus the thin
  wrapper variant under test. The draft should preserve the rule that wrappers
  stay minimized and separately classified rather than expanding cli/model
  coupling inside shared prompt artifacts.
- The deterministic tests in this stage should focus on renderer correctness,
  not broader behavior evals. In addition to the acceptance-criteria list, the
  draft should call out failure-path assertions for registry-load validation and
  make delimiter coverage explicitly defend the existing non-recursive plan-mode
  behavior where injected placeholder-looking text remains literal data.

## Refine turn 2

- Preserve a concrete ownership boundary based on the current v1 surfaces. The
  shared registry/renderer contract in this stage should target agent-bound
  prompt artifacts such as the patch prompt body in
  `v1/src/modes/patch/prompt.ts`, injected patch `rules.md`, and the plan
  prompt files under `v1/src/modes/plan/prompts/`. Keep human-facing CLI
  chooser and confirmation strings, such as project disambiguation text in
  `v1/src/disambiguation-prompt.ts`, outside the first registry contract unless
  the draft explicitly argues they need the same shared governance.
- Treat adapter-local prompt transport as a separately classified layer, not as
  part of the stable shared prompt identity. The current Codex invocation
  marker wrapper in `v1/src/agents/codex.ts` is the concrete example: shared
  step renders should stay agent-agnostic, while thin wrapper variants remain
  minimized, selected by runtime code, and snapshot-covered without becoming
  new prompt IDs of their own.
- Require the draft to call out the exact validation phase boundary. Duplicate
  IDs, missing required metadata, and unknown fragment/override references
  should all fail during registry load before any render attempt, so tests can
  assert deterministic failure paths without depending on a specific step
  invocation.
- Keep the first renderer contract compatible with the existing patch prompt
  split between static instructions and runtime-generated context. Static prompt
  text and declared placeholders can move under the shared contract, but
  generated sibling-directory bullets and similar conditional formatting should
  remain in TypeScript. That keeps this stage focused on registry/rendering
  guarantees rather than smuggling broader prompt-builder logic into templates.
- The migration boundary should stay reviewable even if layering support lands
  here. A good drafting constraint is: no new prompt wording, no expansion of
  prompt scope to interactive CLI UX text, and no attempt to make adapter
  wrappers part of shared prompt identity. The only semantic additions in this
  stage should be ID-based lookup, metadata validation, renderer invariants,
  and revision-aware snapshot keying.

## Refine turn 3

- Keep the first shared renderer aligned with the behavior already enforced by
  `v1/src/modes/plan/template-renderer.ts`: placeholder substitution is
  single-pass over the original template source, missing/unknown placeholders
  are hard errors, and placeholder-looking text inside injected values remains
  literal data. The draft for this stage should preserve that behavior as a
  contract requirement rather than accidentally broadening template syntax or
  introducing recursive expansion semantics.
- Split snapshot scope by execution layer, not just by file location. Shared
  prompt snapshots should cover the agent-facing prompt body assembled before
  transport, including ordered fragment composition and declared placeholders,
  while runtime-only formatting such as sibling-directory bullet generation in
  `v1/src/modes/patch/prompt.ts` can remain TypeScript-owned test inputs around
  the renderer rather than becoming new template logic. Wrapper snapshots
  should then record the post-render adapter layer separately for cases like
  the Codex invocation marker append in `v1/src/agents/codex.ts`.
- Keep the first registry rollout focused on prompts that materially shape an
  agent run or plan-phase spec generation, and avoid mixing in authoring-only
  helper surfaces unless the draft justifies them. In practice that means the
  draft should be explicit about whether `name-only.md` and `inline-draft.md`
  belong in the same registry/snapshot regime as `draft.md`, `review.md`,
  `refine.md`, patch prompt content, and patch `rules.md`, because they are
  adjacent files but not the same governance risk.
- Preserve a narrow failure model for registry load and render APIs. Unknown
  fragment membership, unknown override targets, duplicate IDs, and missing
  required metadata should all fail before any runtime prompt build, while
  render-time failures should be reserved for missing or type-invalid
  placeholder inputs against an otherwise valid loaded registry. Calling out
  that separation in the draft will keep tests deterministic and prevent lazy
  path-based fallback behavior from leaking back in.

