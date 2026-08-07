---
name: approval-decided-at
---

# Durable approval decision timestamp

Carved from `durable-terminal-timestamps` (see `run-stage-terminal-finish`). This is the approval-decision half; independent of run/stage finish (different state-store methods). The daemon-wire projection stays in `terminal-timestamps-on-daemon-wire`.

## Problem

Approval rows record `approved`/`rejected` with no decision timestamp, so gate wait and idle time are not derivable from durable state. `decidedAt`/`decided_at` appears nowhere in the codebase.

## Decisions

- Approval decisions record `decidedAt`, not `endedAt` — rules out overloading `endedAt` on gate rows, which would make a gate decision indistinguishable from workflow-stage settlement and shift pipeline finish derivation onto gates.
- Awaiting-since gets no column; consumers derive it from the predecessor stage's `endedAt` — rules out a second timestamp column.
- Store schema changes are forward-only appended migrations.

## Acceptance criteria

- [ ] `commitApprovalDecision` persists `decidedAt` on the decided row for both `approved` and `rejected`; `loadPipeline` and `listPipelines` expose it on the stage record; it stays null on undecided rows. A `state-store.test.ts` test pins this and fails against pre-fix code.
- [ ] `reopenFailedPipeline` tests stay green, and the reopened row and its skipped suffix clear `decidedAt` alongside the lifecycle payloads reopen already clears.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` § Schema, API, and Semantics — the stage `decided_at` column; `commitApprovalDecision` records `decidedAt`; reopen clears it.
- `v2/docs/v1-behaviors.md` — approval decisions now record `decidedAt`.

## Prerequisites

- `commitApprovalDecision` transitions one approval row `awaiting` → `approved` or `rejected` by durable `PipelineStageRecord.id`, first writer wins, and writes no decision timestamp today.
- `loadPipeline` and `listPipelines` expose stage records; no `decidedAt`/`decided_at` field exists anywhere in the codebase yet.
- `reopenFailedPipeline` clears prior-attempt lifecycle payloads on the reopened row and its skipped suffix.
- Store schema changes are forward-only appended migrations (`reconciled_at` landed that way).
