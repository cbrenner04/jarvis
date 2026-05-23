# 01 - Update prompt governance docs and snapshot coverage for global fragments

Capture the new fragment artifact and assembled outputs in the governance docs and tests so the shared terse layer is treated as a first-class prompt artifact rather than an implicit runtime detail.

## Decisions

- Keep test fallout focused on loaded artifacts and final rendered prompt outputs. Do not invent a separate fragment snapshot scheme in this change.
- Treat registry membership, rendered snapshots, and prompt-shape assertions as the enforcement points for the new global fragment rollout.
- Update rollout documentation anywhere it still claims the registry contains only the original five step/rules artifacts or that relocation introduced no wording/registry changes.
- Consume the concrete artifact revisions established by `00` rather than re-deciding them here; this subspec is about coverage and documentation for the implemented runtime behavior.

## Task Checklist

- [ ] Update `v1/test/prompts/registry.test.ts` to assert that `global.terse` is part of the loaded artifact set.
- [ ] Update rendered snapshot coverage under `v1/test/fixtures/prompts/rendered/` and `v1/test/prompts/rendered-snapshots.test.ts` for the affected patch/draft/refine/review prompt revisions.
- [ ] Update prompt-shape assertions that currently hard-code patch prompt line ordering around `patch.rules` so they match the prefixed terse fragment.
- [ ] Document the fragment artifact, assembly behavior, and revised rollout inventory in `v1/docs/prompt-governance.md`.
- [ ] Update `v1/docs/agents.md` statements that currently describe the old registry rollout and relocation scope.
- [ ] Keep documentation aligned with the narrow design choice from `00`: one shared `global.terse` fragment, no duplicate terseness wording inside step prompts or `patch.rules`.

## Documentation updates

- [ ] Document the global fragment artifact and revised artifact inventory in `v1/docs/prompt-governance.md` and `v1/docs/agents.md`.

## Acceptance criteria

- [ ] Registry tests explicitly cover `global.terse` as part of the prompt artifact set loaded by `createPromptRegistry()`.
- [ ] Rendered snapshot tests continue to validate the final assembled patch, draft, refine, and review prompt bodies by revision-aware filenames after the terse fragment is introduced.
- [ ] Patch prompt tests that assert exact rendered ordering are updated to reflect the new prefixed terse fragment while still verifying `patch.rules` placement and sibling-block behavior.
- [ ] `v1/docs/prompt-governance.md` documents fragment artifacts and the updated rollout/snapshot inventory in terms consistent with the implemented runtime behavior.
- [ ] `v1/docs/agents.md` no longer claims the first registry rollout is limited to the pre-fragment artifact set or that prompt relocation introduced no registry/wording changes.
- [ ] The docs and tests make the single-source terseness policy explicit: the shared fragment is the only new terse instruction in agent-facing prompt text, and coverage is asserted at assembled-output level rather than by duplicating fragment prose across artifacts.
