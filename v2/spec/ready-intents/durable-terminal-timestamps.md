---
name: durable-terminal-timestamps
---

# Durable terminal timestamps for runs, stages, and approval decisions

## Problem

Terminal rows can be persisted with no finish time. `setRunStatus(runId, "failed")` and `commitGuardedKill` write a terminal run status and nothing else — only `commitCompletionBoundary` stamps attempt `completed_at` — so a run failed at the spawn boundary has no durable finish timestamp anywhere. `updateStage` accepts a terminal `status` with no `endedAt` in the patch and persists it; `skipRemainingStages` (`v2/src/daemon/pipeline-execution.ts`) does exactly that with `patch: { status: "skipped" }`. Approval rows record `approved`/`rejected` with no decision timestamp, so gate wait and idle time are not derivable from durable state.

## Decisions

- The run finish timestamp is stamped at the durable terminal transition, not derived at read time — rules out a projection that invents one from `createdAt` or the clock.
- The stage-terminal `endedAt` invariant is enforced where the stage row is written, so a caller that omits it cannot persist a finishless terminal row — rules out a caller-side audit alone, which the next settle path is free to regress.
- `skipped` counts as terminal for that invariant — rules out leaving blocked-suffix rows finishless and out of `derivePipelineFinishedAtMs`' max.
- Approval decisions record `decidedAt`, not `endedAt` — rules out overloading `endedAt` on gate rows, which would make a gate decision indistinguishable from workflow-stage settlement and shift pipeline finish derivation onto gates.
- Awaiting-since gets no column; consumers derive it from the predecessor stage's `endedAt` — rules out a second timestamp column.
- The wire and store keep `startedAt` null on a stage that failed before start; no start time is invented.

## Acceptance criteria

- [ ] A run driven to a terminal status through `setRunStatus` alone (the spawn-boundary failure-capture shape, which records no attempt and no `reconciledAt`) carries a durable run finish timestamp; a `state-store.test.ts` test naming that shape fails against the pre-fix code.
- [ ] `commitGuardedKill` leaves the killed row with a durable finish timestamp.
- [ ] A terminal stage status persisted with no `endedAt` in the patch is not constructible; the `patch: { status: "skipped" }` write `skipRemainingStages` issues today lands `endedAt`, and a `state-store.test.ts` test pinning that fails against the pre-fix code.
- [ ] `commitApprovalDecision` persists `decidedAt` on the decided row for both `approved` and `rejected`; `loadPipeline` and `listPipelines` expose it on the stage record, and it stays null on undecided rows.
- [ ] Mutation checkpoint: in `state-store.test.ts` test `terminal stage status without endedAt still persists an end timestamp`, a `// @mutate` directive neutering the terminal-status stamp turns that regression RED.
- [ ] `state-store.test.ts` `reopenFailedPipeline` tests stay green, and the reopened row and its skipped suffix clear `decidedAt` alongside the lifecycle payloads reopen already clears.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` § Schema — the run finish column and stage `decided_at`.
- `v2/docs/state-store.md` § API and § Semantics — terminal run transitions and terminal stage writes always record a finish time; `commitApprovalDecision` records `decidedAt`; `startedAt` stays null on a stage that failed before start.
- `v2/docs/v1-behaviors.md` — record that `setRunStatus`, `commitGuardedKill`, and terminal `updateStage`/`skipRemainingStages` writes now always carry a finish timestamp, and approval decisions now record `decidedAt`.

## Prerequisites

- `commitCompletionBoundary` stamps attempt `completed_at` and is the only run-settlement path recording a finish timestamp today.
- `setRunStatus` persists a run status update outside a completion boundary and writes no timestamp.
- `commitGuardedKill` sets `killed` unless the row is already boundary-terminal, and writes no timestamp.
- `runListTerminalFinishAtMs` derives a run finish time from attempt `completed_at` and run `reconciledAt`, and yields nothing when neither source has one.
- `updateStage` applies a targeted lifecycle patch keyed by `(pipelineId, stageId, branchKey)` covering `status`, `startedAt`, and `endedAt`.
- `skipRemainingStages` writes `status: "skipped"` to every later stage on a branch with no `endedAt`.
- `commitApprovalDecision` transitions one approval row `awaiting` → `approved` or `rejected` by durable `PipelineStageRecord.id`, first writer wins.
- `reopenFailedPipeline` clears prior-attempt lifecycle payloads on the reopened row and its skipped suffix.
- `reconcilePipelines` already marks orphaned active stages `interrupted` with an end timestamp.
- Store schema changes are forward-only appended migrations (`reconciled_at` landed that way).
