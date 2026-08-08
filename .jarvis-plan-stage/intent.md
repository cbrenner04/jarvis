---
name: terminal-timestamp-persistence
---

# Durable terminal timestamps in the state store

Persistence half of the terminal-timestamps work (superseding the concern-split `run-stage-terminal-finish` + `approval-decided-at`, which each straddled the persistence/daemon boundary and tripped the single-surface contract). The daemon observation-wire projection is the dependent sibling `terminal-timestamps-on-daemon-wire`.

**Scope: `v2/src/persistence/state-store.ts` only.** The daemon wire, `pipeline_list`, and list projections are out of scope and must not be referenced here — they belong to `terminal-timestamps-on-daemon-wire`.

## Problem

Terminal rows persist with no finish time, and approval decisions record no decision time. `setRunStatus(runId, "failed")` and `commitGuardedKill` write a terminal run status and nothing else — only `commitCompletionBoundary` stamps attempt `completed_at`. `updateStage` accepts a terminal `status` with no `endedAt` and persists it as a finishless terminal row. `commitApprovalDecision` records `approved`/`rejected` with no timestamp.

## Decisions

- The run finish timestamp is stamped at the durable terminal transition in the store (`setRunStatus`, `commitGuardedKill`), not derived at read time — rules out a read-time fallback.
- `updateStage` stamps `endedAt` whenever it persists a terminal `status`, so a finishless terminal stage row is not constructible from the store API — rules out a caller-side audit.
- `commitApprovalDecision` records `decidedAt` on the decided row; `reopenFailedPipeline` clears it — rules out overloading `endedAt` on gate rows.
- `startedAt` stays null on a stage that failed before start; no start time is invented.
- Schema changes are forward-only appended migrations.

## Acceptance criteria

- [ ] A run driven to a terminal status through `setRunStatus` alone (the spawn-boundary failure shape: no attempt, no `reconciledAt`) carries a durable finish timestamp; a `v2/src/persistence/state-store.test.ts` test naming that shape fails against pre-fix code.
- [ ] `commitGuardedKill` leaves the killed row with a durable finish timestamp.
- [ ] `updateStage` persisting a terminal `status` with no `endedAt` in the patch lands a non-null `endedAt` and leaves `startedAt` untouched; a `state-store.test.ts` test pins it and fails against pre-fix code, which persists the row finishless.
- [ ] `commitApprovalDecision` persists `decidedAt` for both `approved` and `rejected`; `loadPipeline`/`listPipelines` expose it; it stays null on undecided rows; `reopenFailedPipeline` clears it on the reopened row and its skipped suffix.
- [ ] Mutation checkpoint: in `state-store.test.ts` test `updateStage stamps endedAt on a terminal status write`, a `// @mutate` neutering the terminal-status stamp turns that regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` § Schema — the run finish column and the stage `decided_at` column.
- `v2/docs/state-store.md` § API and Semantics — terminal run and terminal stage writes always record a finish time; `commitApprovalDecision` records `decidedAt` and `reopenFailedPipeline` clears it; `startedAt` stays null on a stage that failed before start.
- `v2/docs/v1-behaviors.md` — the state store now records a finish timestamp on every terminal run and stage write and a decision timestamp on every approval decision.

## Prerequisites

- `commitCompletionBoundary` stamps attempt `completed_at` and is the only state-store path recording a finish timestamp today.
- `setRunStatus` persists a run status update outside a completion boundary and writes no timestamp.
- `commitGuardedKill` sets `killed` unless the row is already boundary-terminal, and writes no timestamp.
- `updateStage` applies a targeted lifecycle patch covering `status`, `startedAt`, and `endedAt`, and does not require `endedAt` on a terminal write today.
- `commitApprovalDecision` transitions one approval row `awaiting` → `approved`/`rejected` by durable id, first writer wins, and records no decision timestamp.
- `reopenFailedPipeline` clears prior-attempt lifecycle payloads on the reopened row and its skipped suffix.
- Schema changes are forward-only appended migrations (`reconciled_at` landed that way).
