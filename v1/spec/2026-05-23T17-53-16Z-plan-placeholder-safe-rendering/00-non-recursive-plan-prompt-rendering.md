# 00 - Non-recursive plan prompt rendering

## Problem

Plan-mode prompt builders currently guard against template corruption by
rejecting injected values that contain literal placeholder tokens such as
`<INTENT>` or `<SPEC_GUIDANCE>`. That guard prevents one class of sequential
`replaceAll` corruption, but it also makes legitimate planning content
unrepresentable.

The reproduced failure is:

1. `jarvis1 plan v2/spec/wip-intents/v2-prompts.txt` starts a refine pass.
2. The first refine agent appends useful prompt-governance notes to
   `intent.md`, including exact placeholder tokens used by existing prompt
   templates.
3. The second refine turn refuses to build its prompt and exits with
   `plan: model configuration error` because the refined intent now contains
   literal strings such as `<INTENT>` or `<SPEC_GUIDANCE>`.

For prompt-governance work, exact prompt placeholder tokens are data. Jarvis
must allow them inside intent text, generated refine notes, current-spec
snapshots, and other injected values without treating them as template syntax.

## Scope

Replace the over-broad placeholder-collision approach in v1 plan-mode prompt
rendering with non-recursive template rendering. Keep this scoped to the prompt
builders and related tests/docs; do not relocate prompts, redesign prompt
governance, or change v2 architecture implementation.

Likely code areas:

- `v1/src/modes/plan/refine.ts`
- `v1/src/modes/plan/name-only.ts`
- `v1/src/modes/plan/draft.ts`
- `v1/src/modes/plan/review.ts`
- `v1/src/modes/plan/inline-draft.ts`
- a new small shared renderer module under `v1/src/modes/plan/`, if useful
- plan prompt tests under `v1/test/modes/plan/`
- v1 docs that describe placeholder collisions or plan exit semantics
- v2 docs/spec material that describes prompt rendering or placeholder
  validation behavior

## Decisions

- Render placeholders from the original template source only.
- Do not recursively scan or rewrite inserted values after insertion.
- Allow injected values to contain exact strings such as `<INTENT>`,
  `<SPEC_GUIDANCE>`, `<NAME>`, `<WORKDIR>`, `<CURRENT_SPEC>`,
  `<INLINE_INTENT>`, or `<REVIEW_PASS_CONTEXT>`.
- Keep sentinel delimiters such as `<<<INTENT_BEGIN>>>` and
  `<<<INTENT_END>>>`; they continue to bound user or agent-authored data.
- Continue to fail when the template source references a placeholder the
  renderer does not know how to fill, because that indicates a
  harness/template mismatch.
- Continue to fail when a required template value is missing.
- Preserve normal rendered prompt output as much as practical.
- Do not report literal placeholder-looking text in injected values as
  `model_config`.

## Implementation Notes

Prefer a small shared helper over repeating rendering logic in each prompt
builder. A reasonable contract is:

- input: template string, allowed placeholder names, and a value map
- output: rendered string
- behavior: scan the original template for placeholder tokens, substitute each
  token with the corresponding value, and leave placeholder-looking strings in
  inserted values untouched
- validation: throw a typed prompt-rendering error for unknown template
  placeholders or missing values

If the renderer validates unknown placeholders with a generic token pattern,
make sure it does not mistake delimiter text such as
`<<<INTENT_BEGIN>>>` for a placeholder.

The current `PlaceholderCollisionError` tests should be replaced or reframed.
The important invariant is no longer "intent values cannot contain
placeholder tokens"; it is "template placeholders are resolved exactly once
from the original template source."

## Documentation Updates

Update v1 docs where they currently say literal placeholder collisions are a
fatal configuration/model-configuration error. The docs should instead explain
that plan prompt rendering is non-recursive, so placeholder-looking text inside
intent/spec data is allowed and treated as data.

Review at least:

- `v1/docs/plan-mode.md`
- `v1/docs/quota-signals.md`, only if exit-code wording becomes inaccurate
- `v1/docs/spec-guidance.md`, only if prompt-rendering guidance is needed there

Update v2 documentation where needed, especially material that discusses prompt
rendering, prompt governance, exact prompt artifacts, or placeholder
validation. Review at least:

- `v2/spec/v1-behaviors.md`
- `v2/spec/v2-vision.md`
- any prompt-governance wip intent or doc present when the implementation runs

The v2 docs should not claim that exact placeholder tokens are forbidden in
prompt data. If they mention this behavior, they should say that v1 plan
rendering treats injected content as data by using non-recursive substitution.

## Acceptance criteria

- [ ] V1 plan prompt builders use non-recursive placeholder rendering for
      refine, name-only, draft, review, and inline-draft prompts.
- [ ] Injected values may contain exact placeholder-looking strings such as
      `<INTENT>` and `<SPEC_GUIDANCE>` without prompt-building failure or
      recursive substitution.
- [ ] Template-source placeholders are still fully substituted for normal
      prompt builds.
- [ ] Prompt rendering fails with a typed harness/template error when a
      template references an unknown placeholder or omits a required value.
- [ ] Existing tests that expect `PlaceholderCollisionError` for
      placeholder-looking injected values are updated to assert the new
      behavior.
- [ ] A regression test covers the reproduced refine failure shape: building a
      refine prompt with an intent containing literal `<INTENT>` and
      `<SPEC_GUIDANCE>` succeeds and preserves those strings inside the
      injected intent block.
- [ ] V1 docs no longer describe literal placeholder text in prompt data as a
      fatal model-configuration collision.
- [ ] V2 docs/spec material that mentions prompt rendering or placeholder
      validation is updated where needed to match the non-recursive rendering
      behavior.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.
