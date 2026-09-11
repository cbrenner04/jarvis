# Stage rows record skip provenance at write time

## Problem

Both skip writers stamp the same `status: "skipped"`: `skipRemainingStages` (predecessor failure — the work is undone and could legitimately be redone) and fan-out split retirement of the `default` suffix (`pipeline-execution.ts` § split, never applicable again). Nothing durable distinguishes them, so any un-skip path would either wrongly resurrect retired `default` rows or need to re-derive provenance from pipeline shape.

## Decisions

- Provenance is a nullable `pipeline_stages` column, not encoded into `status` — status values are read by many derivation paths and widening the enum would touch all of them.
- Column added via `addColumnIfMissing`; pre-existing rows stay `NULL` (unknown provenance) and no backfill is attempted — inferring provenance from stored shape would guess.
- Provenance is written through the existing `StageLifecyclePatch`/`updateStage` seam rather than a dedicated skip method, so the compare-and-set and terminal-`endedAt` behavior stays single-sourced.
- `updateStage` requires provenance whenever the patch carries `status: "skipped"` and throws if it's missing, and throws if provenance is present without `status: "skipped"` — a skip written through this seam is always provenance-tagged going forward; `NULL` is reserved strictly for rows written before this column existed.
- Any non-skip status write clears the column, so a row reopened or re-terminalized later carries no stale provenance. `reopenFailedPipeline`'s reopen writes `status = 'pending'` via a raw `UPDATE` that bypasses `updateStage`; that statement's null-out list gains `skip_provenance` so a suffix row it reopens carries none forward.
- The write site currently pinned by a `biome-ignore format` single-line comment (`skipRemainingStages`, the predecessor-failure writer) adds `skipProvenance: "provisional"` inline to that same call, preserving the pin. The split `default` retirement call is unpinned and multi-line already; it adds `skipProvenance: "terminal"` as a new field with no formatting constraint.
- Deferred to first consumer: whether provenance is surfaced in TUI/CLI stage rendering — pin when a caller needs it. The record is exposed on `PipelineStageRecord` only.

## Task checklist

- [ ] Add the `skip_provenance` column and the `"provisional" | "terminal"` value type; expose it on `PipelineStageRecord` loads.
- [ ] Accept and validate it in `StageLifecyclePatch`/`updateStage` (require on skip writes, reject off skip writes); clear it on non-skip status writes.
- [ ] Null `skip_provenance` in `reopenFailedPipeline`'s raw reopen `UPDATE`.
- [ ] Pass `provisional` from `skipRemainingStages` and `terminal` from split `default` retirement.
- [ ] Tests + docs.

## Acceptance criteria

- [ ] A state-store test proves a stage row skipped through the predecessor-failure path records provisional provenance and a split-retired `default` row records terminal provenance; it fails against the pre-fix schema.
- [ ] A state-store test proves `updateStage` rejects a patch carrying skip provenance without `status: "skipped"`; it fails against the pre-fix code.
- [ ] A state-store test proves `updateStage` rejects a `status: "skipped"` patch that omits provenance; it fails against the pre-fix code.
- [ ] A state-store test proves a later non-skip status write to a provenance-carrying row clears the provenance; it fails against the pre-fix code.
- [ ] A state-store test proves `reopenFailedPipeline` reopening a provisionally-skipped suffix row clears its provenance; it fails against the pre-fix code.
- [ ] A state-store test proves a row written by a database whose `pipeline_stages` table was created without the provenance column before the store opened loads, after the store's migration runs, with provenance absent.
- [ ] `v2/docs/pipeline-execution.md` documents provisional vs terminal `skipped` and which writer produces each.
- [ ] `v2/docs/state-store.md` documents the provenance field on the stage-patch surface.
- [ ] `v2/docs/v1-behaviors.md` records the changed skip-write semantics.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — provisional vs terminal `skipped`.
- `v2/docs/state-store.md` — provenance on the stage lifecycle patch.
- `v2/docs/v1-behaviors.md` — changed skip semantics.
