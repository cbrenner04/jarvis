# Implement optional review — passes + behavior axes

Single `implement` preset: write (+ hidden shrink) plus optional review step.
`--review-passes 0` omits review; `N > 0` includes one step whose behavior comes
from `--review-behavior debate|light`.

## Scope

- Extend `buildImplementWorkflowSteps`: `--review-passes`, `--review-behavior`
  (`debate` | `light`; default `debate` for v1 parity).
- Builder emits 1 or 2 steps; relax fixed `WORKFLOW_PRESET_LENGTHS` check for
  `implement`.
- Review step runs only after spec complete (zero unchecked AC across linked
  subspecs).
- Debate path: `patch.prompt.review.*` + `verdict-patch.md`.
- Light path: `patch.prompt.review.critic` (new) + `patch.prompt.review-actuator`.
- Project config defaults for both axes (document schema in `v2/docs/` config
  section); CLI overrides win.
- Persist resolved `reviewPasses` + `reviewBehavior` on run metadata for
  list/TUI visibility.

## Decisions

- One preset `implement` — no `implement-reviewed` alias preset.
- Do not hardcode debate-only; behavior is explicit per run or project default.

## Prerequisites

- Implement spec-path + index routing merged (seed 05).
- Workflow loader for `review` and `review-debate` merged (seed 06).

## Out of scope

- Phase 9 router (seed 12) — but run metadata shape should match router schema
  sketch in scratch doc.
- Human gate after implement review.
- v1 patch completion gate retry / fix-up matrix.

## Reference

- `.scratch/v2-operator-workflows.md` — Review selection, §`implement`, seed 09

## Documentation updates

- `v2/docs/write-behavior.md` — implement review flags
- Config doc — project review defaults
