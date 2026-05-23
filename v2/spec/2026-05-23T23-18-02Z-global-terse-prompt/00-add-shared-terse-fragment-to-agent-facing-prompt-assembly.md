# 00 - Add shared terse fragment to agent-facing prompt assembly

Add one shared terse directive to the assembled agent-facing prompts so patch mode and plan draft/review/refine all emit the same guidance from the prompt-governance system rather than repo-local instructions.

## Decisions

- Add a new revisioned prompt artifact at one concrete shared source path under top-level `prompts/`; do not introduce prompt-tree discovery or a new runtime layout migration in this change.
- Treat `global.terse` as the only terse directive in agent-facing prompt bodies. Do not duplicate the same wording into `patch.prompt.body`, `patch.rules`, or the individual plan step templates.
- Keep `patch.rules` unchanged unless implementation reveals a hard requirement the fragment cannot satisfy. Default design is global fragment layered ahead of `patch.prompt.body`.
- Use the existing assembly order `global -> behavior -> step` via `assemblePrompt`.
- Preserve current plan prompt semantics when moving onto assembled rendering: the step body still receives the existing path-text rewrites before placeholder substitution, existing flat-layout wording remains intact, and review pass context injection still works.
- Keep formatting drift narrow. The only intentional rendered-body change is the new terse fragment prefix and any unavoidable blank-line joining from shared assembly.
- Bump prompt revisions for every existing artifact whose rendered output changes because of the new fragment. The new fragment also gets its own `revision`.

## Task Checklist

- [ ] Add the `global.terse` prompt artifact with required frontmatter metadata and tiny terseness wording aligned with `v2/docs/v2-vision.md` guidance.
- [ ] Register the new artifact in the explicit seed list in `v1/src/prompts/registry.ts`.
- [ ] Wire patch prompt assembly to pass `global.terse` through the existing `globalFragmentIds` path so the directive renders ahead of `patch.prompt.body`.
- [ ] Move `buildDraftPrompt`, `buildRefinePrompt`, and `buildReviewPrompt` onto assembled rendering without changing their existing path rewrite and placeholder behavior.
- [ ] Keep `patch.rules` injected through `<PATCH_RULES>` exactly as today; the new terse policy comes only from the shared fragment.
- [ ] Update the affected prompt artifact revisions in the same implementation slice so downstream snapshot names are explicit rather than inferred.

## Documentation updates

- [ ] None in this subspec beyond keeping this file accurate if implementation narrows the exact `global.terse` source path or revision scope; repository docs land in `01`.

## Acceptance criteria

- [ ] A new registered prompt artifact `global.terse` exists under the shared top-level `prompts/` tree with required governance frontmatter (`id`, `behavior`, `kind: fragment`, `revision`) and concise terseness wording intended for all target repos.
- [ ] Patch mode prompt construction passes `global.terse` into prompt assembly so the rendered prompt body places the terse fragment before `patch.prompt.body`, and `patch.rules` remains unchanged apart from shifting later in the final assembled text.
- [ ] `buildDraftPrompt`, `buildRefinePrompt`, and `buildReviewPrompt` use the shared prompt assembler for their step body so `global.terse` appears in each final rendered prompt.
- [ ] Plan prompt builders preserve their current runtime behavior after the assembly change: committed vs external layouts still rewrite `spec/<NAME>/` wording correctly, review prompts still inject the correct pass context, and existing placeholder substitution semantics stay intact.
- [ ] Every prompt artifact whose rendered output changes because of the new fragment has an explicit `revision` bump in this subspec, so snapshot fixture names can be updated deterministically in `01`.
- [ ] The subspec can be implemented and verified without relying on broader prompt-layout migration work under `v2/src` or unrelated prompt rewrites.
