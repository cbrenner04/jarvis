# 00 - Intent debate admission, resolution, and docs

## Problem

Pipeline admission rejects `intent` + `debate` as `unrealizable-review-posture`, and stage resolution has no mapping for that pair. Bare `jarvis run workflow intent` already accepts `--review-behavior debate`, so validated pipelines cannot express a composition the CLI can run.

## Prerequisites

- `validatePipelineDefinition` and `resolveStageWorkflowSteps` exist and map other realizable `(workflow, review)` pairs.
- Bare `jarvis run workflow intent` documents and accepts `--review-behavior debate|light`.

## Decisions

- Drop `intent` + `debate` from `isUnrealizableReview` — rules out leaving that cell unrealizable while bare intent supports debate review.
- Map `intent` + `debate` in `WORKFLOW_POSTURE_PRESETS` to bare preset `intent` and pass `reviewPasses: 1` with `reviewBehavior: "debate"` in `resolveIntentStage` — rules out `intent-reviewed` routing or an unmapped cell.
- Leave `intent` + `light` on the existing `intent-reviewed` preset path and existing `reviewBehavior: "light"` wiring — rules out refactoring light resolution in this slice.
- Pipeline doc tables may use mixed notation deliberately: `light` cells stay `intent-reviewed` (unchanged path); `debate` cells show bare `intent` plus `reviewPasses: 1` / `reviewBehavior: debate` — rules out “half-refactored table” confusion.
- Keep `implement` + `none` as the only unrealizable admission cell — rules out relaxing `implement` + `none` or adding other unrealizable pairs here.
- Align `v2/docs/workflow-runner.md` and `v2/docs/daemon-host.md` posture tables and unrealizable prose; refresh dependent rationale in `workflow-runner.md` (unrealizable count, preset-alias bullets tied to the old two-cell model) — rules out contradictory operator docs.
- Retarget the resolver negative test that today uses `intent` + `debate` to `implement` + `none` so unmapped resolution stays covered after debate maps — rules out dropping unmapped-resolution coverage when inverting the debate case.

## Task checklist

- [ ] Remove the `intent`/`debate` branch from `isUnrealizableReview` in `pipeline-definition.ts`.
- [ ] Add `debate: "intent"` to `WORKFLOW_POSTURE_PRESETS.intent` and pass `reviewBehavior: "debate"` from `resolveIntentStage` when `stage.review === "debate"`.
- [ ] Rename and invert the debate admission test; add fake-builder resolution coverage for builder input; add real-builder resolution test (symmetric to `"intent review none resolves through real preset builders without a review step"`) asserting a `review-debate` step.
- [ ] Retarget the unmapped `(workflow, review)` negative case to `implement` + `none`.
- [ ] Update `v2/docs/workflow-runner.md` and `v2/docs/daemon-host.md` (tables, unrealizable cell, stale dependent prose).
- [ ] Add a `[v2 behavior change]` line to `v2/docs/v1-behaviors.md` for pipeline `intent` + `debate` admission/resolution with file sources.

## Acceptance criteria

- [x] `pipeline-definition-validation.test.ts` renames `"intent under debate is unrealizable; light on the same stage validates clean"` to a title that matches realizable debate (e.g. debate and light both validate clean on the same stage); the test fails on baseline expecting `unrealizable-review-posture` for debate and passes after the guard is removed; re-adding the `intent`/`debate` unrealizable branch makes it fail again.
- [x] `pipeline-stage-resolve.test.ts` adds or updates coverage so fake builders prove `resolveIntentStage` passes `reviewBehavior: "debate"` and `reviewPasses: 1` into the intent preset builder; that test fails on baseline unmapped resolution and fails if debate `reviewBehavior` wiring is inverted.
- [x] `pipeline-stage-resolve.test.ts` adds a real `WORKFLOW_PRESET_BUILDERS` test (parallel to `"intent review none resolves through real preset builders without a review step"`) proving `intent` + `debate` resolves with at least one `review-debate` step; it fails on baseline and fails if debate behavior wiring is inverted.
- [x] `"a stage whose (workflow, review) pair has no table entry returns a resolution failure, not a throw"` uses `implement` + `none` instead of `intent` + `debate` for the failure case.
- [x] `"implement under none is unrealizable; light on the same stage validates clean"` stays green.
- [x] `bun run typecheck` and scoped v2 tests for touched surfaces (`test:v2`, `test:integration:v2` when daemon paths change) pass.
- [x] `v2/docs/workflow-runner.md` and `v2/docs/daemon-host.md` agree: `intent` + `debate` realizable via bare `intent` with one debate pass; only `implement` + `none` unrealizable; mixed table notation per Decisions; dependent unrealizable-count and preset-alias prose matches the single unrealizable cell.
- [x] `v2/docs/v1-behaviors.md` records pipeline `intent` + `debate` realizability and resolution (preset `intent`, `reviewPasses: 1`, `reviewBehavior: debate`) with sources under `v2/src/execution/`.

## Documentation updates

- `v2/docs/workflow-runner.md` — `intent`/`debate` cell; `(workflow, review)` table and unrealizable prose; fix rationale tied to the old two-cell model.
- `v2/docs/daemon-host.md` — same posture table and unrealizable alignment as `workflow-runner.md`.
- `v2/docs/v1-behaviors.md` — `[v2 behavior change]` catalog line with sources.
