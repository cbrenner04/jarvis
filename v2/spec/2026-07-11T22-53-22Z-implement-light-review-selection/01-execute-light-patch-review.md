# Execute a light patch review over the implement worktree

A `review` step can render plan-review prompts but has no patch context, so it
cannot yet review an implement branch. Give the review primitive the same patch
context and eligibility rules the debate step already has.

## Decisions

- Carry `patchReviewContext` (`specPath`, `baseBranch`) on `review` steps and render `patch.prompt.review.critic` per cycle from it — rules out passing a pre-rendered static prompt that cannot see the branch diff or prior verdict.
- Reuse the existing critic-actuator cycle for execution: verdict written to the step's verdict path, actuator applies a non-empty verdict, empty verdict ends review — rules out a patch-specific review executor.
- Apply the existing implement-review eligibility gate (review runs only after the linked subspec completes) to patch-context `review` steps, not only `review-debate` — rules out light review running against an unfinished branch.
- Patch context and plan context are mutually exclusive on a review step — rules out ambiguous prompt rendering.

## Task checklist

- [ ] Extend the review step shape and dispatch with patch review context.
- [ ] Render the critic per cycle (pass number, total passes, prior verdict) through the patch renderer.
- [ ] Extend implement-review eligibility and review-pass derivation to cover patch-context `review` steps.

## Acceptance criteria

- [ ] A `review` step carrying patch review context runs bounded critic-actuator cycles against the implement worktree: each cycle renders `patch.prompt.review.critic` with the current pass number and prior verdict, writes the critic's verdict to the step's verdict path, and runs the actuator only on a non-empty verdict.
- [ ] An empty critic verdict ends the review with a complete outcome without running the actuator.
- [ ] A patch-context `review` step is skipped for the same reason a `review-debate` step is: the linked subspec did not complete.
- [ ] Review-pass derivation for implement runs reports the step's cycle count for patch-context `review` steps as it already does for `review-debate` steps.
- [ ] Critic and actuator roles resolve their own machine bindings for the step, and a missing (agent, role) binding fails role validation before any invocation.

## Documentation updates

- `v2/docs/workflow-runner.md`: document patch-context review dispatch and its eligibility gate.
- `v2/docs/role-resolution.md`: note `critic` now also serves implement review, if the existing table implies plan-only.
