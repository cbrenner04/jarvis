---
name: extract-review-debate-landing-module
---

# Extract review-debate landing into a sibling module

## Primary implementation surface

Execution loop — review-debate step dispatch and post-debate landing in `v2/src/execution/`

Unsplit rationale: Review-debate landing orchestration, its co-located tests, and the module-map doc update all live on the execution-loop review-debate landing seam; resume machines and shared `landReviewedPublicationOutput` stay in workflow-runner for the follow-on intent.

## Problem

Review-debate step execution, post-debate landing orchestration, and actuator-only retry live inline in `workflow-runner.ts`, inflating the file targeted for resume-machine extraction and mixing dispatch with landing settlement.

## Behavior

Review-debate landing orchestration (`runReviewDebateStep`, post-debate landing, actuator-only retry, and their private helpers) moves to a named sibling module; `workflow-runner.ts` keeps the step loop and imports the landing entrypoint. Landing and settlement semantics stay unchanged.

## Decision ledger

- Move only review-debate landing orchestration; rules out extracting shared review-landing promotion (`landReviewedPublicationOutput`) or resume machines in the same review.
- Co-locate debate landing tests with the new module; rules out leaving them in `workflow-runner-debate.test.ts` after the production move.
- Behavior-preserving extraction only; rules out settlement-semantics redesign ([[pipeline-settlement-derives-from-run-rows]] owns that).

## Acceptance criteria

- [ ] `workflow-runner-debate-landing-structure.test.ts` fails if `runReviewDebateStep`, `tryActuatorOnlyReviewDebateRetry`, `landReviewedOutputOrFail`, or `finishReviewedLanding` remain defined in `workflow-runner.ts` (all four are private inline helpers reachable on main today).
- [ ] `workflow-runner-debate-landing.test.ts` stays green for the debate-last intent promotion and landing-failure cases and the actuator-only retry eligibility cases moved from `workflow-runner-debate.test.ts` — `"promotes, cleans up, and traces a debate-last intent workflow the same as light review"`, `"settles a debate-last intent workflow's landing failure the same as light review, with a trace"`, `"propagates review idleOutputMs through actuator-only debate retry"`, `"exhausted review-debate actuator timeout is not actuator-only-retry eligible; re-dispatch replays the full debate on a fresh row"`, `"re-dispatching after a debate-role failure replays the full debate, not actuator-only"`, and `"multi-cycle review never takes actuator-only admission, even on a last-cycle actuator failure"`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — module map entry for review-debate landing ownership.

## Prerequisites
