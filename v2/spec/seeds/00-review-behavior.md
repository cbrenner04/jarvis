# v2 `review` behavior (critic + actuator)

Add a fourth workflow behavior primitive: lighter than `review-debate`, reusable
anywhere a project wants review without the full adversary → advocate →
adjudicator panel.

## Scope

- `executeReview` in `v2/src/execution/review.ts`: per cycle, read-only
  **critic** → verdict file → **actuator** (verdict text as prompt); empty
  verdict skips actuator and stops the loop; repeat up to `maxCycles`.
- `workflow-runner.ts` dispatches `behavior: "review"`; outcome mapping mirrors
  `review-debate` (`complete`, `invocation_failure`).
- Add **`critic`** to the closed `Role` union (`role-resolution.md`,
  `resolveExecutableRole`); **`actuator`** stays shared with debate.
- Co-located tests: empty verdict, actuator skip, role failure mid-cycle, quota
  fallthrough on critic/actuator bindings.

## Decisions

- New executor module — do not parameterize `executeReviewDebate` with a
  `panel: short` flag.
- `critic` is not `adversary` — separate `(agent, critic) → rungs` bindings.
- No durable mid-cycle resume in this slice (same deferral as debate).
- No workflow presets or prompts in this seed — behavior + runner only.

## Prerequisites

- none

## Out of scope

- `workflow-loader` support for `review` steps (seed 06).
- Intent/plan/implement prompts or presets (seeds 03, 07+).
- Phase 9 router.

## Reference

- `.scratch/v2-operator-workflows.md` — Behavior: `review`, sequencing R1–R3

## Documentation updates

- `v2/docs/role-resolution.md` — `critic` role, `review` behavior row
- `v2/docs/workflow-runner.md` — `review` dispatch section
- `v2/docs/write-behavior.md` — cross-link if review cycle is documented there
