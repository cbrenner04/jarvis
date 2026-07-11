# `plan` workflow — draft only

Operator workflow: ready-intent → spec tree (`index.md` + numbered subspecs).
No review step in this preset.

## Scope

- `buildPlanWorkflowSteps`: `--ready-intent <path>`, `--target-dir`; validate
  ready-intent (`name:`, `## Prerequisites`); copy to spec dir `intent.md`;
  branch `plan/<slug>`.
- Preset `plan`: one `write` step — `role: plan`, `promptId: plan.prompt.draft`.
- Harness: prerequisite gate (blocker in `intent.md`, no spec files on fail);
  draft output contract (index + `NN-*.md` subspecs) — port validation shape
  from v1 plan draft where applicable.
- Timestamped spec dir under `<targetDir>/`.
- Register on workflow launcher.

## Decisions

- Preset name `plan`; review steps are separate seeds (07, 08).
- Publish timing: completion publish at end of write step only in this seed
  (mid-workflow publish deferred to seed 11).

## Prerequisites

- Generic workflow launcher merged (seed 01).

## Out of scope

- `--resume` plan review tail.
- `review` / `review-debate` plan steps.
- Mid-step draft PR (seed 11).

## Reference

- `.scratch/v2-operator-workflows.md` — §`plan`, seed 04

## Documentation updates

- Operator doc — plan workflow (draft-only) flags and artifacts
