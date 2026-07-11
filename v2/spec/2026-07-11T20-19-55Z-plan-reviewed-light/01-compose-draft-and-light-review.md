# Compose the draft and light-review workflow

`plan` drafts a spec tree but has no launcher preset that follows it with the
existing critic-actuator review behavior.

## Decisions

- `plan-reviewed-light` is a separate launcher preset — rules out adding review selection to `plan`.
- Omitted `--review-passes` defaults to `1` — rules out a reviewed preset that silently drafts without review.
- `--review-passes 0` delegates to the one-step `plan` builder — rules out loading critic or actuator bindings for a zero-cycle review.
- Positive pass counts append one `review` step after the loaded draft step — rules out using `review-debate` or constructing role bindings at runtime.
- The light step uses `plan.prompt.review.critic` and the verdict-driven `plan.prompt.review-actuator` contract — rules out the debate prompt set.
- The light step writes `<spec-dir>/verdict-plan.md` — rules out a preset-specific verdict artifact.
- `--review-behavior` is not selectable on this preset; behavior is light — rules out choosing debate through this CLI surface.

## Task checklist

- [ ] Add `plan-reviewed-light` to preset registration and CLI parsing with plan arguments plus non-negative `--review-passes` validation before daemon contact.
- [ ] Extend plan workflow construction to reuse the validated draft setup and, for positive passes, load draft plus one `review` step together.
- [ ] Wire the review step to separate machine-loaded critic and actuator orders, the plan light-review prompts, cycle limit, and durable verdict path.
- [ ] Add focused builder and CLI coverage for routing, validation, pass behavior, loaded role bindings, prompt/verdict wiring, and zero-pass delegation.
- [ ] Align the operator, runner, and v1-behavior documentation with the new preset.

## Acceptance criteria

- [ ] `jarvis run workflow plan-reviewed-light --ready-intent <path> [--target-dir <dir>] [--review-passes <n>]` accepts valid input, rejects invalid pass counts and `--review-behavior` before daemon contact, and leaves `plan` draft-only.
- [ ] With omitted or positive review passes, `plan-reviewed-light` runs the loaded draft before one loaded `review` step whose cycle limit equals the requested passes and whose critic and actuator bindings resolve separately from configured machine roles.
- [ ] The positive-pass review uses `plan.prompt.review.critic`, the existing verdict-driven `plan.prompt.review-actuator` behavior, and `<spec-dir>/verdict-plan.md`.
- [ ] With `--review-passes 0`, `plan-reviewed-light` produces the same one-step draft workflow as `plan`, without loading or invoking a review step.
- [ ] New focused tests cover launcher routing, invalid inputs, default/positive/zero pass composition, loaded critic/actuator roles, prompt IDs, and verdict path.
- [ ] `v2/docs/first-workflow-walkthrough.md`, `v2/docs/workflow-runner.md`, and `v2/docs/v1-behaviors.md` document the CLI, light composition, default and zero-pass behavior, and verdict location.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md`: document operator invocation, pass counts, zero-pass draft-only output, and verdict location.
- `v2/docs/workflow-runner.md`: document preset composition, loader use, and CLI surface.
- `v2/docs/v1-behaviors.md`: record the v2 additive preset behavior.
