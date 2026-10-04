---
name: plan-reviewed-debate
---

# Add the `plan-reviewed` debate preset

## Decisions

- Add `plan-reviewed` as a separate launcher preset; rules out changing `plan` into a behavior-selecting preset.
- Compose draft `write` then `review-debate` only when `--review-passes > 0`; rules out running review for zero passes.
- Use adversary, advocate, adjudicator, and actuator bindings loaded through the workflow loader; rules out constructing runtime-only debate bindings.
- Use `plan.prompt.review.adversary`, `.advocate`, `.adjudicator`, and `plan.prompt.review-actuator`; rules out the light `review` critic path.
- Write the debate verdict at `<spec-dir>/verdict-plan.md`; rules out a preset-specific verdict location.

## Scope

- `jarvis run workflow plan-reviewed --ready-intent <path> [--target-dir <dir>] [--review-passes <n>]` builds the draft step and, for positive passes, one `review-debate` step over that spec tree.
- The review-debate step uses the requested pass count as its cycle limit and the loaded role bindings.
- Zero review passes produces the same draft-only workflow as `plan`.
- Cover launcher routing, step composition, zero-pass omission, prompt and verdict-path wiring, and loaded debate bindings.
- Document `plan-reviewed` versus `plan-reviewed-light` in `v2/docs/workflow-runner.md`.

## Prerequisites

- Plan draft workflow builds a `plan` write step from a ready-intent.
- Workflow loading supports `review-debate` steps with all debate-role bindings.

## Out of scope

- A shared `--review-behavior` selector on `plan`.
- Human review gates.
