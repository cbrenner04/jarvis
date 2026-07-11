# `plan-reviewed` — draft + `review-debate`

Plan preset variant: after draft, run full adversary → advocate → adjudicator →
actuator debate over the spec tree.

## Scope

- Preset `plan-reviewed`: `write` (draft) → `review-debate` when
  `--review-passes > 0`.
- Prompts: existing `plan.prompt.review.adversary` / `.advocate` / `.adjudicator`,
  `plan.prompt.review-actuator`.
- `--review-passes 0` → draft-only (equivalent to preset `plan`).
- Register on workflow launcher; use loader for debate step bindings.

## Decisions

- Heavy plan path uses debate, not `review` behavior.
- Same verdict path convention as seed 07.

## Prerequisites

- `plan` draft workflow merged (seed 04).
- Workflow loader for `review-debate` steps merged (seed 06).

## Out of scope

- Merging light and heavy into one preset with `--review-behavior` (plan may
  add that later; two presets OK for now).
- Human gate.

## Reference

- `.scratch/v2-operator-workflows.md` — §5b, seed 08

## Documentation updates

- Operator doc — `plan-reviewed` vs `plan-reviewed-light`
