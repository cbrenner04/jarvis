# Govern the plan light-review critic prompt

`plan-reviewed-light` needs an advisory editorial critic distinct from the
debate adversary before the workflow can reference it.

## Decisions

- Register `plan.prompt.review.critic` as a plan step prompt — rules out embedding editorial review instructions in workflow code.
- Make the critic editorial over the draft spec tree — rules out reusing the debate adversary prompt and its debate-specific output contract.
- Fill the critic prompt with the plan-review placeholders `WORKDIR`, `NAME`, `INTENT`, `CURRENT_SPEC`, `SPEC_GUIDANCE`, sourced from the review worktree cwd, the plan name, `intent.md`, the materialized draft spec files, and the spec guidance doc — rules out a verdict that cannot judge the draft against its source requirements.
- The critic is advisory-only; it reports gaps and does not write. Write enforcement lives in the light step (see [01](./01-execute-light-plan-review.md)) — rules out ambiguity about the critic mutating the spec tree.

## Task checklist

- [ ] Add the governed critic prompt artifact and registry manifest entry.
- [ ] Add registry/rendered-prompt coverage asserting the artifact renders the `WORKDIR`, `NAME`, `INTENT`, `CURRENT_SPEC`, `SPEC_GUIDANCE` placeholders from their plan-review sources.
- [ ] Update prompt governance and the v2 prompt owner doc with the prompt identity, ownership, placeholders, and plan-review layering.

## Acceptance criteria

- [ ] `plan.prompt.review.critic` resolves through the prompt registry with valid governed metadata and renders the `WORKDIR`, `NAME`, `INTENT`, `CURRENT_SPEC`, and `SPEC_GUIDANCE` placeholders from their plan-review sources.
- [ ] The critic prompt directs the agent to report actionable draft-spec gaps as advice only — no editing or committing — while not using debate adversary semantics.
- [ ] Focused registry and rendered-prompt tests cover the critic's registration and the composed output's placeholders.
- [ ] `v1/docs/prompt-governance.md` and `v2/docs/prompts.md` document `plan.prompt.review.critic` as the editorial critic for the light plan-review workflow, including its placeholders and rendering contract.

## Documentation updates

- `v1/docs/prompt-governance.md`: register the critic and its prompt-layering contract.
- `v2/docs/prompts.md`: record the new prompt as owner, its placeholders, and rendering contract.
