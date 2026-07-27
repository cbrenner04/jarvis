---
name: pipeline-intent-debate-posture-realizes
---

# Pipeline `intent` under `debate` validates and resolves like bare `intent` + debate review

## Problem

`validatePipelineDefinition` treats `intent` + `debate` as unrealizable (`unrealizable-review-posture`), and `resolveStageWorkflowSteps` has no preset mapping for that pair. Bare `jarvis run workflow intent` accepts `--review-behavior debate` today, so admission refuses a composition the harness can run.

## Decisions

- `intent` + `debate` is realizable; admission drops the `intent`/`debate` branch from `isUnrealizableReview` — rules out keeping that cell unrealizable.
- `intent` + `debate` resolves through preset `intent` with `reviewPasses: 1` and `reviewBehavior: "debate"` — rules out routing via `intent-reviewed` or leaving resolution unmapped.
- `intent` + `light` keeps the existing `intent-reviewed` preset path in `WORKFLOW_POSTURE_PRESETS`; only `debate` uses bare `intent` plus explicit behavior — rules out refactoring light resolution in this slice.
- `implement` + `none` stays unrealizable in admission — rules out relaxing the only remaining unrealizable workflow cell.
- Posture realizations in `v2/docs/workflow-runner.md` are stated against bare presets plus `reviewPasses` / `reviewBehavior`, not legacy `*-reviewed` alias names — rules out doc copy that still implies `intent-reviewed` is the debate carrier for pipeline stages.

## Acceptance criteria

- [ ] `pipeline-definition-validation.test.ts` test `"intent under debate is unrealizable; light on the same stage validates clean"` is replaced (or inverted) so `intent` + `debate` validates clean and still asserts `intent` + `light` validates clean; it fails on baseline expecting `unrealizable-review-posture` for debate.
- [ ] `pipeline-stage-resolve.test.ts` test `"a stage whose (workflow, review) pair has no table entry returns a resolution failure, not a throw"` for `intent` + `debate` is replaced so resolution succeeds and built steps carry `reviewBehavior: "debate"`; it fails on baseline unmapped resolution.
- [ ] `pipeline-definition-validation.test.ts` test `"implement under none is unrealizable; light on the same stage validates clean"` still passes unchanged: `unrealizable-review-posture` with stage ID, field `review`, workflow name, and posture in the message.
- [ ] `bun run typecheck` and scoped v2 tests for touched surfaces pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — correct the `intent`/`debate` resolution cell; restate the `(workflow, review)` table against bare presets and review behavior; keep `implement`/`none` as the sole unrealizable workflow cell.

## Prerequisites

- `validatePipelineDefinition` and `resolveStageWorkflowSteps` exist and map other realizable `(workflow, review)` pairs.
- Bare `jarvis run workflow intent` documents and accepts `--review-behavior debate|light`.
