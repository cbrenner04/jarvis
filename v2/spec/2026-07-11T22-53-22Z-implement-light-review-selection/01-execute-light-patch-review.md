# Execute a light patch review over the implement worktree

A `review` step can render plan-review prompts but has no patch context, so it
cannot yet review an implement branch. Give the review primitive the same patch
context and eligibility rules the debate step already has.

## Decisions

- Carry `patchReviewContext` (`specPath`, `baseBranch`) on `review` steps and render `patch.prompt.review.critic` per cycle from it — rules out passing a pre-rendered static prompt that cannot see the branch diff or prior verdict.
- Execute light patch review in a patch-local cycle beside the debate executor, following the established per-context precedent (plan review and patch debate each own their cycle) — rules out threading an optional per-cycle prompt renderer through the shared `executeReviewCycle`, whose only other consumer is the reviewed-intent enforced path and which takes one static critic prompt, so a per-cycle renderer would be dead weight there and widen that path's blast radius for no gain.
- The light actuator receives the same rendered patch actuator prompt debate uses (patch body prompt + review-actuator rules + verdict) — rules out the shared cycle's rendererless default of sending the raw verdict text as the entire prompt, which carries no repo guidance or patch rules.
- The patch critic is read-only by prompt only; no working-tree snapshot/restore guard is applied — rules out reusing the plan critic's restore-on-violation enforcement, which would discard real uncommitted implement work; this matches the read-only-by-prompt debate roles.
- Apply the existing implement-review eligibility gate (review runs only after the linked subspec completes) to patch-context `review` steps, not only `review-debate` — rules out light review running against an unfinished branch.
- Patch context, plan context, and deferred-intent output are mutually exclusive on a review step, and dispatch branches over all three — rules out ambiguous prompt rendering.

## Task checklist

- [ ] Extend the review step shape and dispatch with patch review context, branching over all three mutually exclusive review shapes.
- [ ] Render the critic per cycle (pass number, total passes, prior verdict) through the patch renderer.
- [ ] Execute the light cycle patch-locally, rendering the shared patch actuator prompt for the actuator turn.
- [ ] Extend implement-review eligibility and review-pass derivation to cover patch-context `review` steps.

## Acceptance criteria

- [ ] A `review` step carrying patch review context runs bounded critic-actuator cycles against the implement worktree: each cycle renders `patch.prompt.review.critic` with the current pass number and prior verdict, writes the critic's verdict to the step's verdict path, and runs the actuator only on a non-empty verdict.
- [ ] The light actuator is invoked with the same rendered patch actuator prompt as the debate actuator — patch body guidance plus review-actuator rules plus the verdict — not the bare verdict text.
- [ ] An empty critic verdict ends the review with a complete outcome without running the actuator.
- [ ] A critic that edits files does not fail the role and does not trigger a working-tree restore; the light review proceeds on the critic's verdict.
- [ ] A patch-context `review` step is skipped for the same reason a `review-debate` step is: the linked subspec did not complete.
- [ ] Review-pass derivation for implement runs reports the step's cycle count for patch-context `review` steps as it already does for `review-debate` steps.
- [ ] Critic and actuator roles resolve their own machine bindings for the step, and a missing (agent, role) binding fails role validation before any invocation.

## Documentation updates

- `v2/docs/workflow-runner.md`: document patch-context review dispatch and its eligibility gate.
- `v2/docs/role-resolution.md`: note `critic` now also serves implement review, if the existing table implies plan-only.
