# Govern the patch light-review critic prompt

Light review for implement needs a single read-only critic over the branch
change, distinct from the three debate roles, before any workflow can bind it.

## Decisions

- Register `patch.prompt.review.critic` as a patch step prompt — rules out embedding critic instructions in workflow code.
- Reuse the patch review render context (`SPEC_PATH`, `SPEC_TREE`, `BRANCH_DIFF`, `REVIEW_PASS_CONTEXT`) that the debate roles already render from — rules out a second, divergent patch-review context shape.
- The critic emits the verdict directly (empty output = nothing to fix) and does not write — rules out reusing the adjudicator's debate-synthesis contract, which presumes prior adversary/advocate turns.

## Task checklist

- [ ] Add the governed critic prompt artifact and its registry manifest entry.
- [ ] Render the critic through the existing patch review-prompt renderer, reusing the shared patch context.
- [ ] Cover registration and rendered placeholders with focused tests.

## Acceptance criteria

- [ ] `patch.prompt.review.critic` resolves through the prompt registry with valid governed metadata and renders `SPEC_PATH`, `SPEC_TREE`, `BRANCH_DIFF`, and `REVIEW_PASS_CONTEXT` from the same patch-review sources the debate roles use.
- [ ] The critic prompt directs the agent to emit the actionable verdict for the branch change as read-only output — no editing, no committing — and to emit nothing when the branch needs no changes.
- [ ] The critic prompt does not use debate semantics (no adversary findings, advocate rebuttal, or adjudication of prior turns).
- [ ] Registry and rendered-prompt tests cover the critic's registration and composed output.

## Documentation updates

- `v1/docs/prompt-governance.md`: register the critic and its prompt-layering contract.
- `v2/docs/prompts.md`: record the prompt as owner, with placeholders and rendering contract.
