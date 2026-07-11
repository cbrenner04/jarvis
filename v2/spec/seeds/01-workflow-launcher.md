# Generic `jarvis run workflow <name>` launcher

Replace the one-off `cli.ts` handler for `implement` with a preset registry:
`jarvis run workflow <name> [flags]` → builder → daemon `start { steps }`.

## Scope

- Registry maps preset name → `build*WorkflowSteps` (start with `implement` moved
  onto the registry without behavior change).
- Unknown preset: usage + exit 1 before daemon contact.
- Preserve existing `jarvis run workflow implement` flags and behavior.
- Co-located CLI tests: known preset, unknown preset, builder error surfacing.

## Decisions

- Builders stay separate modules; registry only wires name → builder.
- No new presets beyond migrating `implement` in this seed.

## Prerequisites

- `review` behavior merged (seed 00) — runner can dispatch `review` even if no
  preset uses it yet.

## Out of scope

- `intent` / `plan` builders (seeds 02, 04).
- Daemon auto-start.
- Project review defaults (`reviewPasses` / `reviewBehavior`).

## Reference

- `.scratch/v2-operator-workflows.md` — §1, Builders, CLI shape

## Documentation updates

- `v2/docs/write-behavior.md` — `jarvis run workflow <name>` contract
- `v2/docs/onboarding.md` — if it still claims v2 is not ready
