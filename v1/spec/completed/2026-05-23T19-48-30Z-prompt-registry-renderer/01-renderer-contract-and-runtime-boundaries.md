# 01 - Renderer contract and runtime boundaries

## Problem

Once prompt artifacts have stable IDs, Jarvis still needs a shared rendering
contract that is narrow enough to review and strong enough to protect current
behavior. The current v1 prompt surfaces split responsibilities across Markdown
source, `v1/src/modes/plan/template-renderer.ts`, prompt-building TypeScript,
and adapter-local wrappers such as the Codex invocation marker append in
`v1/src/agents/codex.ts`.

Without an explicit contract, fragment ordering, override behavior, placeholder
validation, delimiter handling, and wrapper selection can drift or be
re-implemented inconsistently. This stage needs to preserve existing
single-pass, non-recursive rendering semantics while clarifying what belongs in
prompt source versus what stays in TypeScript runtime code.

## Decisions

- The first shared renderer assembles agent-facing prompt bodies in deterministic
  order: global fragments, then behavior fragments, then the step task text.
- Step-level prompt source may explicitly `add` or `remove` fragments from that
  default layering. The override model is explicit only; there is no implicit
  path ordering or recursive graph expansion beyond the contract documented in
  the prompt design.
- Placeholder declarations live with prompt source and include enough metadata
  to validate required presence and expected type. Render-time failures are
  reserved for missing placeholder inputs or type-invalid inputs against an
  otherwise valid loaded registry.
- User-supplied data remains delimiter-bounded and render substitution remains
  non-recursive, aligned with `v1/src/modes/plan/template-renderer.ts`: the
  renderer scans the original template source once, substitutes declared
  placeholders once, and treats placeholder-looking text inside injected values
  as literal data.
- Delimiter policy enforcement belongs to renderer/runtime code, not to prompt
  wording. Prompt source can declare where delimited user data is injected, but
  the runtime owns insertion and validation of the sentinel boundaries.
- Runtime-generated formatting that is conditional or data-structural, such as
  sibling-directory bullet generation in `v1/src/modes/patch/prompt.ts`,
  remains TypeScript-owned and is passed into the renderer as already-prepared
  values rather than being turned into new template logic.
- Adapter-local transport wrappers remain a separate layer selected by runtime
  code after shared prompt rendering. Wrapper choice can vary by adapter, but
  wrappers do not become distinct shared prompt IDs.

## Task checklist

- [ ] Define and implement deterministic shared render assembly order for the
      included prompt artifacts.
- [ ] Implement explicit `add`/`remove` override handling for step-level prompt
      definitions.
- [ ] Implement placeholder declaration, requiredness, and type validation at
      the renderer boundary.
- [ ] Preserve or adapt the existing non-recursive substitution behavior so
      placeholder-looking injected text remains literal data.
- [ ] Implement or centralize delimiter policy enforcement for injected user
      content.
- [ ] Wire runtime prompt builders to the renderer while keeping wrapper
      selection and runtime-only formatting outside prompt identity.
- [ ] Add deterministic tests for ordering, overrides, placeholder validation,
      delimiter preservation, non-recursive substitution, and wrapper
      selection boundaries.

## Acceptance criteria

- [x] Shared prompt rendering for the included surfaces is deterministic and
      follows the contract `global -> behavior -> step`.
- [x] Step-level explicit overrides can add and remove named fragments, and
      tests prove removal is honored rather than silently ignored.
- [x] Placeholder declarations are enforced at render time: missing required
      values and type-invalid values fail with hard renderer errors against a
      valid loaded registry.
- [x] Placeholder-looking text inside injected user content remains literal data
      after render; the renderer does not recursively expand inserted values.
- [x] Delimiter policy is enforced for injected user data so the rendered
      prompt preserves the intended sentinel boundaries for intent/spec/context
      data blocks.
- [x] Runtime-only formatting logic stays in TypeScript and is exercised as
      renderer input rather than being moved into template conditionals.
- [x] Adapter wrappers are selected after shared render and are tested as a
      separate post-render layer rather than as distinct shared prompt IDs.

## Documentation updates

- [x] Update prompt-governance and developer docs to describe the renderer
      ownership boundary: what prompt source controls, what TypeScript runtime
      code controls, and the guarantee of non-recursive substitution.
- [x] Document the delimiter policy and explicit override semantics in the
      prompt-maintenance guidance used by future prompt editors.

## Out of scope

- Broadening template syntax with general conditional logic.
- Recursive prompt expansion or layered composition beyond the documented first
  contract.
- Expanding the shared renderer to human-facing CLI chooser text.
