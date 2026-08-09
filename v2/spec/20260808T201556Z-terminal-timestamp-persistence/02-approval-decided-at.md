# Approval decision timestamp

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`commitApprovalDecision` transitions a gate row `awaiting` → `approved` / `rejected` with a status write and nothing else, so the store keeps no record of when a gate was decided. Nothing distinguishes a gate decided a second ago from one decided yesterday.

## Decision ledger

- New nullable `pipeline_stages.decided_at`, exposed as `PipelineStageRecord.decidedAt` and therefore on `loadPipeline` / `listPipelines`. Rules out overloading `ended_at` on gate rows (`01-terminal-stage-finish.md` keeps decided-approval statuses off the stage-finish path).
- The stamp rides `commitApprovalTransition`'s existing conditional `UPDATE`, so it commits or fails with the status transition and the first writer keeps both. Rules out a second statement, which could stamp a row a concurrent decision won.
- `commitApprovalTransition` takes a required `decidedAt: number | null`, so every call site states its intent: the boundary passes `null`, the decision passes the clock. Rules out an optional field that silently defaults, where a new transition would inherit "no stamp" by omission.
- `reopenFailedPipeline` clears `decided_at` on the reopened row and its skipped suffix, alongside the other prior-attempt lifecycle payloads. An `approved` predecessor is untouched by reopen and keeps its decision time.
- `updateStage` cannot write `decided_at`: `StageLifecyclePatch` is unchanged, so the decision time is only settable through a conditional approval decision. Rules out a free-form lifecycle patch fabricating one.
- Migration appends as `024-pipeline-stage-decided-at`, no backfill; pre-migration and undecided rows read `null`.

## Prerequisites

- `commitApprovalDecision` and `commitApprovalBoundary` share `commitApprovalTransition`, whose conditional `UPDATE … WHERE id = ? AND status = ?` gives first-writer-wins (`v2/src/persistence/state-store.ts`).
- `STAGE_COLUMNS` + `mapStageRow` project stage columns onto `PipelineStageRecord` by spread, and `StageRow` derives from that type, so a new aliased column flows through both `loadPipeline` and `listPipelines`.
- `reopenFailedPipeline` clears prior-attempt lifecycle payloads with one prepared `reopenLifecycle` statement reused for the failed row and each skipped suffix row.
- `reopenPredecessorAllowsStatus` admits `approved` predecessors, so a decided gate can sit before the failed row.

## Tasks

- `v2/src/persistence/state-store.ts`:
  - Append `{ id: "024-pipeline-stage-decided-at", up: "ALTER TABLE pipeline_stages ADD COLUMN decided_at INTEGER" }` to `SCHEMA_MIGRATIONS`. `INSERT_PIPELINE_STAGE_SQL` needs no change — the column defaults to `NULL`.
  - `PipelineStageRecord` gains `decidedAt: number | null` (Unix epoch ms of the approval decision; `null` until decided); `STAGE_COLUMNS` gains `decided_at AS decidedAt`.
  - `commitApprovalTransition` args gain `decidedAt: number | null`; its write becomes `UPDATE pipeline_stages SET status = ?, decided_at = ? WHERE id = ? AND status = ?` run with `args.nextStatus, args.decidedAt, args.stageRecordId, args.requiredStatus`.
  - `commitApprovalDecision` passes `decidedAt: Date.now(),` (keystone anchor) and `commitApprovalBoundary` passes `decidedAt: null,` (boundary-guard anchor); each occurs exactly once in the file and must stay on one physical line.
  - `reopenFailedPipeline`'s `reopenLifecycle` `SET` list gains `decided_at = NULL,` — the reopen-guard anchor.
- Tests — add to `v2/src/persistence/state-store.test.ts`:
  - `commitApprovalDecision stamps decidedAt on the decided row`: for `approved` and `rejected` on separate pipelines, assert the decided row's `decidedAt` is a number at or after a captured bound and that every other stage row reads `null`; assert `listPipelines` reports the same value as `loadPipeline`. Carries the keystone `// @mutate`.
  - `commitApprovalBoundary leaves decidedAt null on an awaiting row`: after the boundary write, assert `status` is `awaiting` and `decidedAt` is null; a refused decision (`status_not_awaiting`) leaves it null too. Carries the boundary-guard `// @mutate`.
  - `reopenFailedPipeline clears decidedAt on the reopened row and its skipped suffix`: admit a `[plan (workflow), gate (approval), gate-two (approval)]` pipeline; drive `plan` to `succeeded`; boundary-and-decide both gates so each carries `decidedAt`; write `gate` to `failed` and `gate-two` to `skipped` through `updateStage`; reopen and assert both rows are `pending` with `decidedAt` null, while a decided `approved` predecessor in a separate reopen fixture keeps its `decidedAt`. Carries the reopen-guard `// @mutate`.
- Update existing tests that compare whole stage records (`toEqual` on `PipelineStageRecord` shapes in `v2/src/persistence/state-store.test.ts` and any daemon test doing the same) to include `decidedAt: null`.
- Docs per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [x] `v2/src/persistence/state-store.test.ts` — `commitApprovalDecision stamps decidedAt on the decided row` asserts a non-null `decidedAt` on the decided row for both `approved` and `rejected`, exposed identically by `loadPipeline` and `listPipelines`, with sibling rows null; it fails against the pre-fix code, which records no decision time.
- [x] `v2/src/persistence/state-store.test.ts` — `commitApprovalBoundary leaves decidedAt null on an awaiting row` asserts an `awaiting` row and a refused decision both leave `decidedAt` null, proving the stamp is suppressed off the decision path.
- [x] `v2/src/persistence/state-store.test.ts` — `reopenFailedPipeline clears decidedAt on the reopened row and its skipped suffix` asserts both reopened rows read `decidedAt` null while an untouched `approved` predecessor keeps its value.
- [x] `v2/src/persistence/state-store.test.ts` — `commitApprovalDecision stamps decidedAt on the decided row`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/persistence/state-store.ts "decidedAt: Date.now()," -> "decidedAt: null,"` inside the test body — baseline semantics where a decision records no timestamp — and the mutation turns that regression RED.
- [x] `v2/src/persistence/state-store.test.ts` — `commitApprovalBoundary leaves decidedAt null on an awaiting row`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/persistence/state-store.ts "decidedAt: null," -> "decidedAt: Date.now(),"` inside the test body — stamping the boundary transition as if it were a decision — and the mutation turns that regression RED.
- [x] `v2/src/persistence/state-store.test.ts` — `reopenFailedPipeline clears decidedAt on the reopened row and its skipped suffix`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/persistence/state-store.ts "decided_at = NULL," -> "decided_at = decided_at,"` inside the test body — a reopen that carries the prior attempt's decision time forward — and the mutation turns that regression RED.
- [x] Existing approval tests (`inverting pending-boundary guard fails approval boundary regression`, `inverting approval-kind guard fails approval boundary regression`, and the concurrent first-writer-wins decision test) stay green, with refused writes still leaving every row unchanged.
- [x] `v2/docs/state-store.md` documents `pipeline_stages.decided_at`, the `024-pipeline-stage-decided-at` migration, and that only `commitApprovalDecision` sets it while `reopenFailedPipeline` clears it.
- [x] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` § Schema — the `pipeline_stages` bullet gains nullable `decided_at` (Unix epoch ms of the approval decision, `null` until decided, not writable through `StageLifecyclePatch`); the forward-only list gains `024-pipeline-stage-decided-at` (no backfill, pre-migration rows read `null`).
- `v2/docs/state-store.md` § API — `commitApprovalDecision` stamps `decided_at` in the same conditional write as the status transition (refused writes stamp nothing); `commitApprovalBoundary` leaves it null; `reopenFailedPipeline`'s cleared payload list gains `decided_at`, with untouched `approved` predecessors keeping theirs; `loadPipeline` / `listPipelines` expose `decidedAt` on every stage record.
- `v2/docs/v1-behaviors.md` — record that approval decisions now persist a decision timestamp on the stage row, exposed on loaded and listed stage records and cleared by in-place reopen.
