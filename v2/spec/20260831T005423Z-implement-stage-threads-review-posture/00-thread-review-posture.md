# Thread reviewPasses and reviewBehavior into the implement stage input

## Problem

A pipeline implement stage ignores its defined `review` posture and always runs a full **debate** review, even for a `fast` pipeline whose implement stage is `review: "light"`. Root cause: in `v2/src/daemon/pipeline-stage-resolve.ts`, `resolveIntentStage` and `resolvePlanStage` both populate `reviewPasses: stageReviewPasses(stage)` and, for `light`/`debate`, `reviewBehavior: stage.review` on their workflow input — but `resolveImplementStage` (the `BuildImplementWorkflowStepsInput` at ~line 307) omits **both**. The implement builder therefore sees `input.reviewBehavior === undefined` and defaults to `"debate"` (`v2/src/execution/implement-workflow-steps.ts` review-config resolution), and `reviewPasses` falls to its own default. Every pipeline implement stage runs debate regardless of posture — ~4 review roles instead of the intended 1 critic for `light`, a silent cost/time/posture regression introduced when the front-door dispatch refactor threaded review posture for intent/plan but missed implement.

## Surface

`resolveImplementStage` input construction in `v2/src/daemon/pipeline-stage-resolve.ts`; co-located regressions in `pipeline-stage-resolve.test.ts`; the pipeline-execution doc. No change to `stageReviewPasses`, the intent/plan resolvers, the registry definitions, or standalone `jarvis run workflow implement` defaults.

## Decision ledger

- Populate `resolveImplementStage`'s `BuildImplementWorkflowStepsInput` with `reviewPasses: stageReviewPasses(stage)` and `...(stage.review === "light" || stage.review === "debate" ? { reviewBehavior: stage.review } : {})`, mirroring `resolveIntentStage`/`resolvePlanStage` exactly. Rules out re-deriving or defaulting posture at the builder.
- An implement stage is only ever `light` or `debate` — `implement` + `none` is intentionally unrealizable (`resolveImplementWorkflowStage` returns `unmappedResult` for a non-`light`/`debate` implement stage before `resolveImplementStage` runs), so `stageReviewPasses(stage)` here always yields 1 and the `reviewBehavior` spread always fires. Threading both still mirrors the intent/plan resolvers exactly and future-proofs against the default. Rules out relying on the builder's debate default.
- Applies before the `usesDefaultBuilder` projectRoot/projectName spread, so both default and injected builders receive the posture. Rules out threading it on only one builder path.

## Task checklist

- Add `reviewPasses` and the conditional `reviewBehavior` to the initial `input` literal in `resolveImplementStage`, matching the intent/plan resolvers.
- Add `pipeline-stage-resolve.test.ts` regressions asserting the resolved implement input/steps carry the posture (see acceptance criteria).
- Update the pipeline-execution doc.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` test `implement stage threads light review posture` resolves an implement stage with `review: "light"` and asserts the built input/steps carry `reviewBehavior: "light"` and `reviewPasses: 1` (a single critic pass, not debate); it fails against the pre-fix omission that defaults to debate.
- [ ] `pipeline-stage-resolve.test.ts` test `implement stage threads debate review posture` resolves `review: "debate"` and asserts `reviewBehavior: "debate"`, `reviewPasses: 1` (no regression to the `full-review` posture).
- [ ] `pipeline-stage-resolve.test.ts` test `implement stage rejects an unrealizable none posture` asserts an `implement` stage with `review: "none"` is refused as unmapped before `resolveImplementStage` (documenting that `implement` + `none` stays unrealizable, so posture threading only ever sees `light`/`debate`).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/pipeline-execution.md` — the implement stage dispatches with its resolved review posture (`none`/`light`/`debate`), same as intent and plan; a `fast` implement stage runs a single light critic, not debate.
