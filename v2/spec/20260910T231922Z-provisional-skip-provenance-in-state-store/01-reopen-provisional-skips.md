# Branch-scoped reopen of provisional `skipped` rows

## Problem

The only un-skip path is `reopenFailedPipeline`, which is anchored on a `failed` row and reopens its contiguous skipped suffix. A branch whose provisional skips need returning to `pending` without a `failed` anchor has no store operation, and any naive reopen would also resurrect terminal split-retired `default` rows.

## Decisions

- New store method reopens provisional `skipped` rows for one branch to `pending`, clearing the same lifecycle columns `reopenFailedPipeline` clears (`workflow_invocation_id`, `started_at`, `ended_at`, `artifact`, `decided_at`, `failure_detail`) plus the provenance column.
- Selection is by recorded provenance only: terminal and provenance-less (`NULL`) rows are never touched — inferring intent for legacy rows would guess.
- No `failed` anchor and no contiguity requirement; the whole branch's provisional skips reopen. Anchoring would reintroduce the limitation this exists to remove.
- The operation only reads and reopens provisional `skipped` rows; it never inspects or mutates a `failed` row on the same branch, even if one exists — reopening a `failed` anchor stays `reopenFailedPipeline`'s job, and widening this operation to also handle one would duplicate it.
- `branchKey` defaults to `default` like the rest of the stage API; sibling branches are never touched.
- Outcome type is its own shape, not reused from `reopenFailedPipeline` (whose `applied` arm carries one `stageRecordId`, not a list): `{ kind: "applied"; pipelineId: string; stageRecordIds: readonly string[] }` for any known pipeline (an empty array when no provisional skips matched) or `{ kind: "refused"; pipelineId: string; reason: "pipeline_not_found" }` when the pipeline id itself doesn't resolve.
- Selection re-reads provisional `skipped` rows for the branch inside the transaction, then compare-and-sets each individually (`WHERE id = ? AND status = 'skipped' AND skip_provenance = 'provisional'`). A row that loses that race — a concurrent settlement already terminalized it — is silently excluded from `stageRecordIds` rather than aborting the whole call: this operation has no single anchor row, so no `reopen_lost`-style refusal reason applies to it.
- Deferred to first consumer: which daemon/CLI path invokes it — pin when a caller needs it. This subspec adds the store operation and its tests only.

## Task checklist

- [ ] Add the reopen method and its outcome type to the `StateStore` interface and implementation, with per-row compare-and-set inside one transaction.
- [ ] Tests + docs.

## Acceptance criteria

- [ ] A state-store test proves the reopen returns provisional `skipped` rows to `pending` with lifecycle columns cleared and no `failed` row present; it fails against the pre-fix code.
- [ ] A state-store test proves the reopen leaves terminal split-retired `default` rows `skipped`.
- [ ] A state-store test proves the reopen leaves provenance-less legacy `skipped` rows `skipped`.
- [ ] A state-store test proves the reopen is branch-scoped: a sibling branch's provisional `skipped` rows are untouched.
- [ ] A state-store test proves that on a branch holding both a `failed` row and provisional `skipped` rows, the reopen returns the provisional skips to `pending` and leaves the `failed` row unchanged.
- [ ] A state-store test proves the reopen refuses an unknown pipeline id, returning `{ kind: "refused", reason: "pipeline_not_found" }` with no reopened rows.
- [ ] `v2/docs/state-store.md` documents the branch-scoped provisional-skip reopen.
- [ ] `v2/docs/v1-behaviors.md` records the added un-skip path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — provisional-skip reopen API and scoping.
- `v2/docs/v1-behaviors.md` — the added un-skip path.
