# Co-locate debate landing tests

## Problem

Debate-last intent promotion, landing-failure, and actuator-only retry eligibility coverage lives in `workflow-runner-debate.test.ts` beside unrelated dispatch cases, so landing regressions are harder to localize after the production move.

## Surface

Primary: `v2/src/execution/workflow-runner-debate-landing.test.ts` (new). In-scope: `workflow-runner-debate.test.ts` (source of moved cases only).

## Prerequisites

- Subspec 00 complete: `workflow-runner-debate-landing.ts` exists with exported `runReviewDebateStep`, `landReviewedOutputOrFail`, and `finishReviewedLanding`.

## Decisions

- Co-locate debate landing tests with `workflow-runner-debate-landing.ts`; rules out leaving the moved cases in `workflow-runner-debate.test.ts` after the production move.
- Move only the six ready-intent-named cases; rules out relocating unrelated dispatch, implement-chain, or surviving-mutation cases in this slice.
- Preserve moved case titles, assertions, fixtures, and `// @mutate` directives byte-for-byte; rules out weakening coverage while thinning the source file.

## Task checklist

- Create `workflow-runner-debate-landing.test.ts` beside `workflow-runner-debate-landing.ts`.
- Move these cases unchanged from `workflow-runner-debate.test.ts`: `promotes, cleans up, and traces a debate-last intent workflow the same as light review`, `settles a debate-last intent workflow's landing failure the same as light review, with a trace`, `propagates review idleOutputMs through actuator-only debate retry`, `exhausted review-debate actuator timeout is not actuator-only-retry eligible; re-dispatch replays the full debate on a fresh row`, `re-dispatching after a debate-role failure replays the full debate, not actuator-only`, `multi-cycle review never takes actuator-only admission, even on a last-cycle actuator failure`.
- Extract shared setup helpers into the new file or a sibling support import only when required to avoid substantial duplication; rules out copied fixture drift.

## Acceptance criteria

- [ ] `workflow-runner-debate-landing.test.ts` stays green for the six moved cases (`promotes, cleans up, and traces a debate-last intent workflow the same as light review`, `settles a debate-last intent workflow's landing failure the same as light review, with a trace`, `propagates review idleOutputMs through actuator-only debate retry`, `exhausted review-debate actuator timeout is not actuator-only-retry eligible; re-dispatch replays the full debate on a fresh row`, `re-dispatching after a debate-role failure replays the full debate, not actuator-only`, `multi-cycle review never takes actuator-only admission, even on a last-cycle actuator failure`).
- [ ] `workflow-runner-debate.test.ts` stays green for the remaining dispatch cases after the move.
- [ ] `bun run test:v2` passes.

## Documentation updates

None — test placement doc for resume machines is follow-on scope.
