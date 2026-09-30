# Settlement rollup prior-lane input and reopened-implement regression

## Problem

Linked stage settlement calls `resolveWorkflowRunRollup` with invocation siblings only. After `pipeline resume`, a gate-only implement completion leaves no `implement-review` row in the new invocation while the entry row is `completed` with `terminalCause: "complete"`, PR evidence, and `attemptCount: 0`. Rollup returns `killed`, so `settleLinkedStagesFromEntryRunWith` writes `failed` with `resumable_kill` even though list/wait already roll the same shape up `completed` when prior-lane runs are supplied. Settlement projection when rollup is `completed` already succeeds; the bug is missing prior-lane input at settlement, not a new succeeded/failed rule.

## Decisions

- Extend `LinkedStageSettlementStore` with `findWorkflowRunsOnLane` and pass the shared persistence prior-lane thunk into `resolveWorkflowRunRollup` inside `settleLinkedStagesFromEntryRunWith` — rules out duplicating a settlement-only rollup predicate or special-casing PR-bearing completed entry rows when rollup is non-`completed`.
- One persistence-layer helper builds the lazy prior-lane thunk for `resolveWorkflowRunRollup`; daemon rollup callers and `settleLinkedStagesFromEntryRunWith` both use it — rules out a second inline `priorLaneRunsForWorkflowRollup` loop in the daemon and settlement importing daemon modules.
- Do not change `stageFailureDetailFromEntryRun`, PR-evidence wedge, or compare-and-set settlement writes when rollup is already `completed`.
- Regression fixture uses an implement + `implement-review` snapshot, entry implement row only in the invocation, prior same-lane invocation with `completed` `implement-review`, entry PR pair on the row under settlement — rules out a single-durable-step snapshot that skips the missing-successor path.

## Tasks

- [ ] Extract the shared persistence prior-lane thunk helper; rewire daemon rollup callers and settlement (`settleLinkedStagesFromEntryRunWith` must not import daemon modules).
- [ ] Add prior-lane runs to the settlement rollup call; extend `LinkedStageSettlementStore` and real `StateStore` wiring.
- [ ] Add `pipeline-stage-settlement.test.ts` reopened-implement regression per acceptance criteria.
- [ ] Align `pipeline-execution.md`, `state-store.md`, and `v1-behaviors.md` per Documentation updates (settlement inputs/outcome only; cross-link `workflow-runner.md`).

## Acceptance criteria

- [ ] `pipeline-stage-settlement.test.ts` adds a reopened-implement-shaped case: completed entry `implement` row with `terminalCause: "complete"`, zero attempts, PR evidence, no `implement-review` sibling row, prior same-lane `completed` review row, running linked stage settles `succeeded` with that PR evidence on the artifact; fails against the pre-fix `resumable_kill` path reachable via `settleLinkedStagesFromEntryRunWith` today (`pipeline-stage-settlement.test.ts` test `a missing-step killed rollup does not report the completed entry row's status` constructs the killed-rollup settlement failure).
- [ ] `pipeline-stage-settlement.test.ts` `settleLinkedStagesFromEntryRunWith` and `settleLinkedStagesFromEntryRunWith failure cause` describe blocks stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — settlement-only: non-live rollup inside settlement reads prior same-lane runs like daemon list/wait; reopened implement that finishes without new work settles `succeeded` with entry PR evidence; cross-link `v2/docs/workflow-runner.md` for skipped-durable-successor rollup — do not copy prerequisite rollup prose.
- `v2/docs/state-store.md` — `settleLinkedStagesFromEntryRun` rollup bullet: prior-lane run input at settlement and operator-visible outcome; cross-link `v2/docs/workflow-runner.md` — do not restate skipped-durable-successor rules.
- `v2/docs/v1-behaviors.md` — operator-visible linked stage outcome for that path (behavior change vs pre-fix `resumable_kill` failure).
