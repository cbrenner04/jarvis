# `plan-reviewed-light` — draft + `review` behavior

Plan preset variant: after draft write step, run `review` (critic + actuator)
over the spec tree.

## Scope

- Preset `plan-reviewed-light`: `write` (draft) → `review` when
  `--review-passes > 0`; omit review step when `--review-passes 0` (same as
  preset `plan`).
- Flags: `--review-passes N`, `--review-behavior light` (fixed for this preset).
- Prompts: `plan.prompt.review.critic` (new), `plan.prompt.review-actuator`
  (existing); govern new critic prompt.
- Verdict: `<spec-dir>/verdict-plan.md`.
- Builder shares plan draft setup with seed 04.

## Decisions

- Separate preset name — not a flag on `plan` alone — keeps composed step list
  visible; builder may share internals.
- Editorial critic tone — do not reuse debate adversary prompt verbatim.

## Prerequisites

- `plan` draft workflow merged (seed 04).
- Workflow loader for `review` steps merged (seed 06).
- `review` behavior merged (seed 00).

## Out of scope

- `review-debate` plan preset (seed 08).
- Human gate.
- Mid-workflow publish (seed 11).

## Reference

- `.scratch/v2-operator-workflows.md` — §5, seed 07

## Documentation updates

- `v1/docs/prompt-governance.md` — `plan.prompt.review.critic`
- Operator doc — plan light review preset
