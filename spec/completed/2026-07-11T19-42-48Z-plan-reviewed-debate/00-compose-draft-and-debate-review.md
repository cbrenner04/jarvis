# Compose draft and debate review

`plan` drafts a spec tree but has no launcher preset for the full plan-review
debate.

## Decisions

- `plan-reviewed` is a separate launcher preset; rules out making `plan` behavior-selecting.
- Omitted `--review-passes` defaults to `1`; rules out a reviewed preset that drafts without review by default.
- `--review-passes 0` delegates to the draft-only `plan` workflow; rules out creating a review step with zero cycles.
- Positive review passes append one `review-debate` step after the draft `write` step; rules out the light `review` behavior.
- The debate step loads adversary, advocate, adjudicator, and actuator bindings through `loadWorkflowSteps`; rules out runtime-constructed role bindings.
- Debate prompts are `plan.prompt.review.adversary`, `.advocate`, `.adjudicator`, and the verdict-driven `plan.prompt.review-actuator`; rules out the light-review critic prompt.
- The debate verdict path is `<spec-dir>/verdict-plan.md`; rules out a preset-specific verdict location.

## Task checklist

- [ ] Add `plan-reviewed` to the workflow launcher, with the plan ready-intent/target-dir arguments plus non-negative `--review-passes` validation before daemon contact.
- [ ] Extend the plan workflow builder and preset validation to compose the loaded draft step with one loaded `review-debate` step for positive passes.
- [ ] Add focused builder and CLI coverage for routing, default/positive/zero passes, role-binding loading, prompt IDs, cycle limit, and verdict path.
- [ ] Update `v2/docs/workflow-runner.md` with `plan-reviewed` operator usage and its distinction from `plan-reviewed-light`.

## Acceptance criteria

- [x] `jarvis run workflow plan-reviewed --ready-intent <path> [--target-dir <dir>] [--review-passes <n>]` accepts valid input, rejects invalid pass counts before daemon contact, and leaves `plan` without a review-selection flag.
- [x] With omitted or positive review passes, `plan-reviewed` runs the draft before one `review-debate` step whose cycle limit equals the requested passes, four role orders come from configured workflow loading, and the step uses the plan debate prompts and `<spec-dir>/verdict-plan.md`.
- [x] With `--review-passes 0`, `plan-reviewed` produces the same one-step draft workflow as `plan`, with no debate step.
- [x] New focused tests cover launcher routing and draft-plus-debate composition, including loaded debate roles, prompt/verdict wiring, and zero-pass omission.
- [x] `v2/docs/workflow-runner.md` documents `plan-reviewed`, its default and zero-pass behavior, and when to choose it instead of `plan-reviewed-light`.

## Documentation updates

- `v2/docs/workflow-runner.md`: document the `plan-reviewed` CLI, composition, pass behavior, verdict path, and contrast with `plan-reviewed-light`.
