# Fail-workflow-stage guard deletion and stacked-PR docs

## Problem

`failWorkflowStageAt` carries a `running` + live-linkage guard no call site can reach after entry-run linkage shipped — retaining it blocks deleting dead code and obscures the real advance/adopt guards that remain intentional.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts` (`failWorkflowStageAt`). In-scope: `pipeline-execution.test.ts` only if a focused guard-deletion assertion is added.

## Prerequisites

- Subspec 00 landed: settlement liveness and deferred detail.

## Decisions

- Delete the unreachable `failWorkflowStageAt` branch that returns `"stop"` when `record?.status === "running"` and `liveLinkedEntryRunId` is defined — rules out retaining a guard no mutation can kill (per spec guidance: dead guard deletion beats an invert test).
- Sibling live-linkage guards in advance catch, adopt, and stranded paths remain — rules out deleting reachable guards.
- Stacked-PR chain (implement based on plan stage branch) and merge-order constraint are operator documentation only in this slice — rules out runtime enforcement beyond subspec 01 retarget.
- Stage failure mirroring and deferred re-settlement mirroring live in subspec 00 — rules out a green-on-baseline mirroring AC here.
- Out of scope: `derivePipelineState` terminality, concurrent sibling dispatch, stage-to-run linkage identity (#2590/#2591).

## Task checklist

- Delete the `liveLinkedEntryRunId` early-return in `failWorkflowStageAt`.
- Document stacked implement-on-plan-branch workflow, merge-first hazard, and recommended merge order when retarget is undesirable in operator runbook (complements subspec 01 retarget prose).

## Acceptance criteria

- [ ] `failWorkflowStageAt` has no live-linkage guard — the unreachable `running` + live-link branch is deleted.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/daemon-host.md` — `failWorkflowStageAt` no longer short-circuits on live-linked `running` rows; sibling adopt/advance guards unchanged.
- `v2/docs/v1-behaviors.md` — removed `failWorkflowStageAt` live-link guard.
- `v2/docs/operator-runbook.md` — § Pipeline start: stacked PR chain (implement on plan stage branch) and recommended merge order when retarget is undesirable.
