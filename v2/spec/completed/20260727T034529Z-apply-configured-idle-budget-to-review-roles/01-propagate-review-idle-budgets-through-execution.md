# Propagate review idle budgets through execution

## Problem

Workflow steps can reconstruct role-invocation inputs at several execution seams, silently losing a stamped idle budget and re-arming the 90 s fallback.

## Decisions

- A stamped positive or zero `idleOutputMs` reaches `invokeReviewRole` unchanged through standard review, non-durable profile review, full review debate, and actuator-only debate retry.
- Only an unstamped review step uses `invokeReviewRole`'s 90 s fallback.
- Zero reaches the invocation boundary as zero and keeps the idle-output watchdog disabled.

## Task checklist

- [ ] Propagate review-step idle budgets through standard and non-durable profile review dispatch.
- [ ] Propagate review-step idle budgets through full debate dispatch and actuator-only retry.
- [ ] Prove configured, absent, and disabled invocation behavior at the binding boundary.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner.test.ts` tests `propagates review idleOutputMs through standard review dispatch` and `propagates review idleOutputMs through non-durable profile review dispatch` capture each configured positive and zero value at `invokeReviewRole`; either test fails when its dispatch reconstruction drops the value.
- [x] `v2/src/execution/workflow-runner.test.ts` test `propagates review idleOutputMs through full review-debate dispatch` captures both configured positive and zero values for adversary, advocate, adjudicator, and actuator; it fails when debate propagation is removed.
- [x] `v2/src/execution/workflow-runner.test.ts` test `propagates review idleOutputMs through actuator-only debate retry` captures both configured positive and zero values for the retry invocation and fails when retry reconstruction drops the value.
- [x] Workflow-path coverage proves an unstamped review step reaches `invokeReviewRole` with its 90 s fallback, while a stamped zero reaches the binding boundary as zero and does not activate that fallback or an idle-output watchdog.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None; durable documentation is isolated in `02-document-review-idle-budget-semantics.md`.
