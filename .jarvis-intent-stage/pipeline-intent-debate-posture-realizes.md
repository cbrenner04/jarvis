---
name: pipeline-intent-debate-posture-realizes
---

# Pipeline `intent` under `debate` validates and resolves like bare `intent` + debate review

## Problem

`validatePipelineDefinition` treats `intent` + `debate` as unrealizable (`unrealizable-review-posture`), and stage resolution has no mapping for that pair. Bare `jarvis run workflow intent` accepts `--review-behavior debate` today, so admission refuses a composition the harness can run.

## Decisions

- `intent` + `debate` is realizable; admission drops the `intent`/`debate` branch from `isUnrealizableReview` — rules out keeping that cell unrealizable.
- `intent` + `debate` resolves through the bare `intent` preset with `reviewPasses: 1` and `reviewBehavior: "debate"` — rules out routing via `intent-reviewed` or leaving resolution unmapped.
- `implement` + `none` stays unrealizable in admission — rules out relaxing the only remaining unrealizable workflow cell.
- Posture realizations in `v2/docs/workflow-runner.md` are stated against bare presets plus review behavior (and `reviewPasses` where `none`), not legacy `*-reviewed` alias names — rules out doc copy that still implies `intent-reviewed` is the light/debate carrier for pipeline stages.

## Acceptance criteria

- [ ] An `intent` workflow stage with `review: "debate"` passes `validatePipelineDefinition`; a test that expects `unrealizable-review-posture` for that stage fails on baseline and passes after the fix.
- [ ] The same stage resolves through real preset builders to steps that include debate review with `reviewBehavior: "debate"` (equivalent to CLI `--review-behavior debate` on bare `intent`); resolution no longer returns unmapped for that pair.
- [ ] An `implement` stage with `review: "none"` still yields `unrealizable-review-posture` with stage ID, field `review`, workflow name, and posture in the message; `implement` + `light` on the same stage still validates clean.
- [ ] `bun run typecheck` and scoped v2 tests for touched surfaces pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — correct the `intent`/`debate` resolution cell; restate the `(workflow, review)` table against bare presets and review behavior; keep `implement`/`none` as the sole unrealizable workflow cell.

## Prerequisites

- `validatePipelineDefinition` and `resolveStageWorkflowSteps` exist and map other realizable `(workflow, review)` pairs.
- Bare `jarvis run workflow intent` documents and accepts `--review-behavior debate|light`.
