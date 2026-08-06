# Stage failure mirroring and guard deletion

## Problem

When an implement stage's entry run settles with a resumable operator error (e.g. `completion_commit_failed` / `resume`), the stage row can still record generic `harness_failure` / `stop` in `failureDetail`. Separately, `failWorkflowStageAt` carries a `running` + live-linkage guard no call site can reach after entry-run linkage shipped.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts` (`failWorkflowStageAt`, stage failure shaping on settled non-success rows). In-scope: `pipeline-execution.test.ts`, `pipeline-stage-dispatch.ts` `failureDetailForEntryRun` only if execution-layer mirroring still delegates there.

## Prerequisites

- Subspec 00 landed: settlement liveness and deferred detail.
- Subspec 01 landed: implement base retarget when remote ref is absent.

## Decisions

- A terminal `failed` stage row's `failureDetail` mirrors the owning entry run's `composeRunOperatorError` result (`reason`, `retryable`, `nextAction`, optional detail fields) from terminal log context — rules out `harness_failure` / `stop` when the run is `resumable: true` with `completion_commit_failed`.
- Delete the unreachable `failWorkflowStageAt` branch that returns `"stop"` when `record?.status === "running"` and `liveLinkedEntryRunId` is defined — rules out retaining a guard no mutation can kill (per spec guidance: dead guard deletion beats an invert test).
- Stacked-PR chain (implement based on plan stage branch) and merge-order constraint are operator documentation only in this slice — rules out runtime enforcement beyond subspec 01 retarget.
- Out of scope: `derivePipelineState` terminality, concurrent sibling dispatch, stage-to-run linkage identity (#2590/#2591).

## Task checklist

- Ensure pipeline stage settlement/observation paths that record terminal `failed` on a settled entry run copy `composeRunOperatorError` from the entry run plus terminal log context (same shape as dispatch settlement mirroring).
- Delete the `liveLinkedEntryRunId` early-return in `failWorkflowStageAt`.
- Add `pipeline-execution.test.ts` — `"stage failureDetail mirrors owning run operator error for completion_commit_failed"`: settled entry run with `completion_commit_failed` terminal log and `resumable: true`; assert stage `failureDetail` matches composed operator error, not `harness_failure` / `stop`.
- Document stacked implement-on-plan-branch workflow and merge-first hazard in operator runbook (complements subspec 01 retarget prose).

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` — `"stage failureDetail mirrors owning run operator error for completion_commit_failed"` fails against the current writer, which records `harness_failure` / `stop`.
- [ ] `failWorkflowStageAt` has no live-linkage guard — the unreachable `running` + live-link branch is deleted.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — stage `failureDetail` mirrors the owning run's operator error on terminal non-success settlement; `failWorkflowStageAt` no longer short-circuits on live-linked `running` rows.
- `v2/docs/v1-behaviors.md` — stage failure mirroring and removed `failWorkflowStageAt` live-link guard.
- `v2/docs/operator-runbook.md` — § Pipeline start: stacked PR chain (implement on plan stage branch) and recommended merge order when retarget is undesirable.
