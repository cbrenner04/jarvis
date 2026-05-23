# 00 - Add shared terse fragment to agent-facing prompt assembly

Add one shared terse directive to the assembled agent-facing prompts so patch mode and plan draft/review/refine all emit the same guidance from the prompt-governance system rather than repo-local instructions.

## Decisions

- Add a new revisioned prompt artifact at one concrete shared source path under top-level `prompts/`; do not introduce prompt-tree discovery or a new runtime layout migration in this change.
- Treat `global.terse` as the only terse directive in agent-facing prompt bodies. Do not duplicate the same wording into `patch.prompt.body`, `patch.rules`, or the individual plan step templates.
- Keep `patch.rules` unchanged unless implementation reveals a hard requirement the fragment cannot satisfy. Default design is global fragment layered ahead of `patch.prompt.body`.
- Use the existing assembly order `global -> behavior -> step` via `assemblePrompt`.
- Preserve current plan prompt semantics when moving onto assembled rendering: path-text rewrites still happen before placeholder substitution, existing flat-layout wording remains intact, and review pass context injection still works.
- Keep formatting drift narrow. The only intentional rendered-body change is the new terse fragment prefix and any unavoidable blank-line joining from shared assembly.

## Task Checklist

- [ ] Add the `global.terse` prompt artifact with required frontmatter metadata and tiny terseness wording aligned with `v2/docs/v2-vision.md` guidance.
- [ ] Register the new artifact in the explicit seed list in `v1/src/prompts/registry.ts`.
- [ ] Wire patch prompt assembly to pass the global fragment ID so `buildPrompt` renders the terse directive ahead of `patch.prompt.body`.
- [ ] Move `buildDraftPrompt`, `buildRefinePrompt`, and `buildReviewPrompt` onto assembled rendering so the same global fragment is emitted in all agent-facing plan prompts.
- [ ] Preserve existing prompt-builder behavior for `targetDir`, external flat spec layouts, placeholder delimiting, pass numbering, and patch-rule injection.

## Documentation updates

- [ ] Update spec-local wording if implementation needs to record a narrower decision about the exact `global.terse` source path or assembly behavior.

## Acceptance criteria

- [ ] A new registered prompt artifact `global.terse` exists under the shared top-level `prompts/` tree with required governance frontmatter (`id`, `behavior`, `kind: fragment`, `revision`) and concise terseness wording intended for all target repos.
- [ ] Patch mode prompt construction layers `global.terse` ahead of `patch.prompt.body` without duplicating terseness guidance inside `patch.rules`.
- [ ] Plan draft, refine, and review prompt builders assemble their prompt body through the shared renderer path so the same global fragment appears in each rendered prompt.
- [ ] Existing plan-specific path rewriting and context injection behavior remains represented in the implementation design: committed vs external layouts still rewrite `spec/<NAME>/` text correctly, and review prompts still inject the correct pass context.
- [ ] The subspec can be implemented and verified without relying on broader prompt-layout migration work under `v2/src` or unrelated prompt rewrites.
