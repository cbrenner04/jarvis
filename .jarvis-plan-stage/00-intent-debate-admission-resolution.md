# 00 - Intent debate admission, resolution, and docs

## Problem

Pipeline admission rejects `intent` + `debate` as `unrealizable-review-posture`, and stage resolution has no mapping for that pair. Bare `jarvis run workflow intent` already accepts `--review-behavior debate`, so validated pipelines cannot express a composition the CLI can run.

## Decisions

- Drop `intent` + `debate` from `isUnrealizableReview` — rules out leaving that cell unrealizable while bare intent supports debate review.
- Map `intent` + `debate` in `WORKFLOW_POSTURE_PRESETS` to bare preset `intent` and pass `reviewPasses: 1` with `reviewBehavior: "debate"` in `resolveIntentStage` — rules out `intent-reviewed` routing or an unmapped cell.
- Leave `intent` + `light` on the existing `intent-reviewed` preset path and existing `reviewBehavior: "light"` wiring — rules out refactoring light resolution in this slice.
- Keep `implement` + `none` as the only unrealizable admission cell — rules out relaxing `implement` + `none` or adding other unrealizable pairs here.
- Restate pipeline posture realizations in `v2/docs/workflow-runner.md` as bare presets plus `reviewPasses` / `reviewBehavior` where applicable — rules out doc copy that treats `intent-reviewed` as the debate carrier for pipeline stages.
- Retarget the resolver negative test that today uses `intent` + `debate` to `implement` + `none` so unmapped resolution stays covered after debate maps — rules out dropping unmapped-resolution coverage when inverting the debate case.

## Task checklist

- [ ] Remove the `intent`/`debate` branch from `isUnrealizableReview` in `pipeline-definition.ts`.
- [ ] Add `debate: "intent"` to `WORKFLOW_POSTURE_PRESETS.intent` and pass `reviewBehavior: "debate"` from `resolveIntentStage` when `stage.review === "debate"`.
- [ ] Update `pipeline-definition-validation.test.ts` and `pipeline-stage-resolve.test.ts` per acceptance criteria.
- [ ] Align `v2/docs/workflow-runner.md` pipeline posture table and unrealizable-cell prose.

## Acceptance criteria

- [ ] `pipeline-definition-validation.test.ts` test `"intent under debate is unrealizable; light on the same stage validates clean"` is replaced so `intent` + `debate` validates clean and `intent` + `light` still validates clean; it fails on baseline expecting `unrealizable-review-posture` for debate.
- [ ] `pipeline-stage-resolve.test.ts` replaces the `intent` + `debate` case in `"a stage whose (workflow, review) pair has no table entry returns a resolution failure, not a throw"` with a success path: resolution succeeds and the `intent` builder input carries `reviewBehavior: "debate"` (and `reviewPasses: 1`); it fails on baseline unmapped resolution. The same test name covers an `implement` + `none` resolution failure instead of debate.
- [ ] `pipeline-definition-validation.test.ts` test `"implement under none is unrealizable; light on the same stage validates clean"` stays green unchanged.
- [ ] Inverting the removed `intent`/`debate` unrealizable guard makes the updated admission test fail; inverting the new debate `reviewBehavior` wiring makes the updated resolution test fail.
- [ ] `bun run typecheck` and scoped v2 tests for touched surfaces (`test:v2`, `test:integration:v2` when daemon paths change) pass.
- [ ] `v2/docs/workflow-runner.md` documents `intent` + `debate` as realizable via bare `intent` with one debate pass; the `(workflow, review)` table and unrealizable-cell note list only `implement` + `none` as unrealizable.

## Documentation updates

- `v2/docs/workflow-runner.md` — correct the `intent`/`debate` resolution cell; restate the `(workflow, review)` table against bare presets and review behavior; keep `implement`/`none` as the sole unrealizable workflow cell.
