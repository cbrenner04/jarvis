# Document plan boundary split

Record the plan-step split contract where operators and spec authors already look for workflow and
subspec sizing rules.

## Decisions

- Durable homes are `v2/docs/workflow-runner.md` and `v1/docs/spec-guidance.md` per the intent —
  rules out duplicating the classifier in prompt-only comments.
- Operator docs cite `shared/module-boundary-surfaces.ts` as the canonical surface list and
  classification contract from [00](./00-module-boundary-classifier.md) — rules out an unenumerated
  "same as intent split" reference.
- `v2/docs/v1-behaviors.md` draft-validation order lists boundary normalization at the start of
  `validatePlanDraftShape` (before structural per-subspec checks) —
  rules out leaving the v1 parity catalog stale after harness behavior changes.

## Tasks

- Document that the plan draft step splits multi-boundary drafted subspecs (AC-owned boundaries only)
  into one emitted subspec per boundary before validation/publish, pointing at
  `shared/module-boundary-surfaces.ts`.
- Document that each subspec should own one module boundary using that shared surface definition.
- Update the v1-behaviors draft-validation order to mention boundary normalization before structural
  per-subspec checks.

## Acceptance criteria

- [x] `v2/docs/workflow-runner.md` states that multi-boundary drafted subspecs are split on emit
      rather than published whole, names acceptance criteria as the oversize signal, and references
      `shared/module-boundary-surfaces.ts`.
- [x] `v1/docs/spec-guidance.md` states that a subspec owns one module boundary and points readers
      to `shared/module-boundary-surfaces.ts` for the surface list.
- [x] `v2/docs/v1-behaviors.md` records boundary-split normalization at the start of
      `validateDraftOutput` before structural per-subspec checks.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan step splits multi-boundary drafted subspecs rather than emitting them whole.
- `v1/docs/spec-guidance.md` — subspec owns one module boundary (`shared/module-boundary-surfaces.ts`).
- `v2/docs/v1-behaviors.md` — draft validation order includes boundary-split normalization.
