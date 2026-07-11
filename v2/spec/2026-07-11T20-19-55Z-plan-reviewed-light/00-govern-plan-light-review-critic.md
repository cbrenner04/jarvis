# Govern the plan light-review critic prompt

`plan-reviewed-light` needs a read-only editorial critic distinct from the
debate adversary before the workflow can reference it.

## Decisions

- Register `plan.prompt.review.critic` as a plan step prompt — rules out embedding editorial review instructions in workflow code.
- Make the critic editorial and read-only over the draft spec tree — rules out reusing the debate adversary prompt and its debate-specific output contract.
- Give the critic the same plan review context needed to assess intent, draft, and spec guidance — rules out a verdict that cannot judge the draft against its source requirements.

## Task checklist

- [ ] Add the governed critic prompt artifact and registry manifest entry.
- [ ] Add registry/rendered-prompt coverage for the new artifact and its plan-review context.
- [ ] Update prompt governance with the prompt identity, ownership, and plan-review layering.

## Acceptance criteria

- [ ] `plan.prompt.review.critic` resolves through the prompt registry with valid governed metadata and the plan review context required for an editorial read-only critique.
- [ ] The critic prompt directs the agent to report actionable draft-spec gaps without editing or committing, while not using debate adversary semantics.
- [ ] Focused registry and rendered-prompt tests cover the critic's registration and composed output.
- [ ] `v1/docs/prompt-governance.md` documents `plan.prompt.review.critic` as the editorial critic for the light plan-review workflow.

## Documentation updates

- `v1/docs/prompt-governance.md`: register the critic and its prompt-layering contract.
