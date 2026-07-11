# 01 - Expose reviewed plan workflow

Expose the built `plan-reviewed` preset through `jarvis run workflow` with the
plan ready-intent arguments plus an optional review-pass count.

## Decisions

- Route `plan-reviewed` through the plan ready-intent parser with optional `--review-passes`; rules out accepting intent seed arguments or a separate argument grammar.
- Default omitted `--review-passes` to one; rules out silently omitting the review step for the reviewed preset.
- Accept zero as draft-only and reject negative or non-integer counts; rules out treating zero as an invalid request or coercing malformed counts.
- Keep `plan` without `--review-passes`; rules out expanding the base preset into a behavior selector.

## Task checklist

- [ ] Add `plan-reviewed` usage, routing, and argument parsing to the workflow launcher.
- [ ] Thread the parsed review-pass count to the reviewed-plan builder and preserve the existing `plan` argument surface.
- [ ] Add CLI coverage for accepted reviewed-plan invocation, zero passes, invalid counts, and rejection of review passes on `plan`.
- [ ] Document the two reviewed plan presets and their review behavior in their durable operator homes.

## Acceptance criteria

- [ ] `jarvis run workflow plan-reviewed --ready-intent <path> [--target-dir <dir>] [--review-passes <n>]` routes a validated ready-intent and pass count to the reviewed-plan builder; an omitted count uses one pass.
- [ ] A reviewed-plan invocation with `--review-passes 0` submits the draft-only workflow, while negative and non-integer counts fail with reviewed-plan usage.
- [ ] `jarvis run workflow plan` continues to reject `--review-passes`.
- [ ] New CLI tests cover reviewed-plan routing, default and zero pass counts, malformed counts, and the unchanged base-plan rejection.
- [ ] `v2/docs/workflow-runner.md` documents `plan-reviewed` alongside `plan-reviewed-light`, distinguishing debate roles from the light critic-actuator review, their shared zero-pass draft-only behavior, command syntax, and `verdict-plan.md`; `v2/docs/v1-behaviors.md` records the v2 workflow surface with sources.

## Documentation updates

- `v2/docs/workflow-runner.md`: document `plan-reviewed` versus `plan-reviewed-light`, usage, pass behavior, role model, and verdict path.
- `v2/docs/v1-behaviors.md`: record the added v2 workflow launcher behavior with source paths.
