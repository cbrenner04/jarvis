# 00 - Compose reviewed plan workflow

Add the programmatic `plan-reviewed` preset builder. It must retain the draft
setup of `plan`, then append one loaded debate step only for positive review
passes.

## Decisions

- Add `plan-reviewed` as a distinct preset builder; rules out making `plan` select review behavior.
- Reuse the plan draft's validated ready-intent, target, worktree, branch, and spec-dir setup; rules out a parallel plan setup that can drift.
- Append exactly one `review-debate` step after the draft when `reviewPasses > 0`; rules out review for zero passes or one step per pass.
- Set the debate step's cycle limit to `reviewPasses`; rules out a separate fixed review limit.
- Load the debate step through `loadWorkflowSteps`; rules out constructing runtime-only role bindings.
- Use `plan.prompt.review.adversary`, `plan.prompt.review.advocate`, `plan.prompt.review.adjudicator`, and `plan.prompt.review-actuator`; rules out the light `review` critic path.
- Write the debate verdict to `<spec-dir>/verdict-plan.md`; rules out a preset-specific verdict location.

## Task checklist

- [ ] Extend the plan workflow input and builder surface for an optional non-negative review-pass count.
- [ ] Build `plan-reviewed` from the plan draft source step and, for positive passes, one `review-debate` source step with the debate prompts, loaded role bindings, requested cycle limit, and plan verdict path.
- [ ] Register the programmatic `plan-reviewed` preset without changing `plan` composition.
- [ ] Add focused builder tests for loaded debate-role wiring, prompt and verdict-path wiring, cycle count, and zero-pass draft-only output.

## Acceptance criteria

- [ ] The `plan-reviewed` builder returns the same one draft write step as `plan` when review passes are zero.
- [ ] With positive review passes, the `plan-reviewed` builder returns the draft write step followed by one loaded `review-debate` step whose adversary, advocate, adjudicator, and actuator bindings come from the workflow loader, whose cycle limit equals the requested count, and whose verdict is `<spec-dir>/verdict-plan.md`.
- [ ] That debate step uses `plan.prompt.review.adversary`, `plan.prompt.review.advocate`, `plan.prompt.review.adjudicator`, and `plan.prompt.review-actuator`, rather than the light-review prompt path.
- [ ] New focused workflow-builder tests cover positive-pass composition and zero-pass omission.

## Documentation updates

- None; this slice adds an unexposed builder. Operator-facing preset semantics are documented with CLI exposure in 01.
