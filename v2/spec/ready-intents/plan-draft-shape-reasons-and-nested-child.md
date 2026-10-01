---
name: plan-draft-shape-reasons-and-nested-child
---

# Plan-draft shape failures name their cause and accept a timestamp-named nested dir

`validatePlanDraftShapeAtRoot` and `resolvePlanDraftStagingRoot` return bare `plan.draft.shape` for four distinct failures; nested-root discovery ignores a single immediate child directory of the stage root (e.g. `<stage>/<timestamp>-<name>/`).

## Decisions

- Emit distinct `failureReason` suffixes: `plan.draft.shape:missing-dir`, `:no-index`, `:no-subspecs`, `:nested-roots=<n>`; propagate through settlement so `jarvis run list`/`wait` and pipeline `failureDetail` show them.
- When top-level shape fails, also accept exactly one immediate child directory of the stage root that contains `index.md` and `NN-*.md`, flattening like existing `spec/<name>/` acceptance.
- In `composePlanDraftArtifactCheck`, treat staging `failureReason` as shape-family when it equals bare `plan.draft.shape` or starts with `plan.draft.shape:`; run the durable-dir fallback for every shape-family miss except `plan.draft.shape:missing-dir`, which settles on staging only.

## Plan fan-out

Implement order: this intent → `plan-draft-shape-contract-reprompt` → `plan-draft-shape-operator-docs` (staged queue order is not implement order).

## Acceptance criteria

- [ ] `v2/src/execution/write.test.ts`: each of the four shape failure fixtures settles its distinct suffixed reason and not bare `plan.draft.shape`; fails against the pre-fix bare reason.
- [ ] Same file: a stage with one immediate child dir holding `index.md` and `00-*.md` resolves, flattens, and passes shape validation; fails pre-fix.
- [ ] `v2/docs/v1-behaviors.md` records suffixed `plan.draft.shape:*` settlement reasons and single immediate-child staging acceptance.

## Primary implementation surface

- `v2/src/execution/write.ts`

## Prerequisites
