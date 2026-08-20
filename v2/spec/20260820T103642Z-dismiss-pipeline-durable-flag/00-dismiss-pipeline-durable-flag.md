# Durable pipeline dismissal column and store operations

## Problem

The `pipelines` table (`v2/src/persistence/state-store.ts`) carries `id`, `name`, `created_at`, `owner_identity`, `status`, `definition`, `context`, `terminal_publication_failure`, and `terminal_publication_succeeded_at` — nothing an operator can set to mark a pipeline dismissed, and no store operation to set or clear such a mark. `listPipelines` therefore returns every admitted pipeline forever, and an abandoned one repaints in `run list`, the TUI work tree, and the needs-attention segment with no durable way to hide it.

The three consumer intents that want to hide dismissed pipelines (`dismiss-pipeline-rpc`, `dismiss-pipeline-cli`, `dismiss-pipeline-tui-display`) each list this store behavior under `## Prerequisites`; none of them can land until a pipeline row can hold a dismissal timestamp that survives a daemon restart.

`v2/spec/ready-intents/dismissed-pipeline-durable-flag.md` is a near-duplicate of this intent (same column, same operations, same unfiltered-`listPipelines` decision, same doc target) — a fan-out name collision. It has been read in full; nothing in it is missing from this spec's decision ledger or acceptance criteria (its migration-fixture verification bullet is folded in below). The stale duplicate is deleted as part of this subspec's task checklist rather than left to collide with a later run.

## Decision ledger

- Dismissal is a nullable `dismissed_at` INTEGER column on `pipelines`, added by forward migration `027-pipeline-dismissed-at` with no backfill (pre-migration rows read `null`) — rules out a process-local or in-memory flag, which would evaporate on daemon restart, exactly the case an operator dismisses a pipeline to survive.
- `dismissPipeline` and `undismissPipeline` return `PipelineDismissalOutcome` (`{ kind: "applied", pipelineId }` | `{ kind: "refused", pipelineId, reason: PipelineDismissalRefusalReason }`, with `PipelineDismissalRefusalReason = "pipeline_not_found"`), matching `PipelineContinuationOutcome`/`PipelineContinuationRefusalReason`'s shape — rules out `createPipelineStageBranch`'s throw-on-unknown-id idiom, which would force the daemon handler to try/catch to produce its own named refusal. Naming the reason union (rather than inlining the string) matches every sibling outcome type in this file and is what the RPC consumer intent will import.
- Dismiss preserves the first dismissal timestamp: the write is guarded `WHERE id = ? AND dismissed_at IS NULL`, mirroring `commitTerminalPublicationSuccess` — rules out an unconditional overwrite, under which re-dismissing would move the timestamp and "idempotent no-op" would be false.
- Undismiss writes `NULL` unconditionally on a known row and reports `applied` — rules out a symmetric `IS NOT NULL` guard, which would need a second refusal reason for the already-undismissed case with no consumer asking for one. Both operations are full no-op successes on their respective already-in-that-state pipeline: re-dismissing a dismissed pipeline leaves the timestamp untouched, and undismissing a never-dismissed pipeline leaves `dismissedAt` at `null`.
- Both operations write only `pipelines.dismissed_at`, scoped to the targeted row by `id`: no other row's `dismissed_at` changes, and no stage rows, `status`, `owner_identity`, or terminal-publication columns change on any row — rules out reusing the reject/kill path, which would couple an operator's display choice to lifecycle state.
- `dismissedAt` rides `PIPELINE_COLUMNS` and `mapPipelineRow`, so `loadPipeline` and `listPipelines` both expose it — rules out an out-of-band second lookup for the daemon projection.
- The store never filters on `dismissed_at`: `listPipelines` still returns dismissed rows, and `reconcilePipelines`/`claimPipelineContinuation` scans are untouched, so a dismissed pipeline keeps executing and keeps being reconciled — rules out store-level filtering, which would hide rows from the restart sweep and silently strand live work. Default-excluding projection belongs to the daemon (`dismiss-pipeline-rpc`). Symmetrically, nothing in the store ever clears `dismissed_at` on a lifecycle transition (a reopened or reconciled pipeline stays dismissed) — dismissal is an operator display choice that outranks lifecycle, and the store has no view of lifecycle transitions to react to.
- `dismissedAt` is a required (non-optional) field on the `Pipeline` type, like its nullable siblings — rules out `dismissedAt?:`, which would let a fake store omit it and drift from the durable row; test fakes constructing whole `Pipeline` objects are updated to set `dismissedAt: null`.
- `v2/docs/v1-behaviors.md` is not touched: this subspec is purely additive and changes no existing behavior. The parity-baseline edit belongs to `dismiss-pipeline-rpc`, where `pipeline_list` stops returning every stored pipeline by default.

## Task checklist

- Add migration `{ id: "027-pipeline-dismissed-at", up: "ALTER TABLE pipelines ADD COLUMN dismissed_at INTEGER" }` to `SCHEMA_MIGRATIONS`.
- Add `dismissed_at AS dismissedAt` to `PIPELINE_COLUMNS`, `dismissedAt: number | null` to `Pipeline`, and the `?? null` normalization to `mapPipelineRow` (matching `terminalPublicationSucceededAt`).
- Add `PipelineDismissalRefusalReason`, `PipelineDismissalOutcome`, and `dismissPipeline` / `undismissPipeline` to the `StateStore` interface and `StateStoreImpl`.
- Add the tests below to `v2/src/persistence/state-store.test.ts` with in-body `// @mutate` directives on the real store guards.
- Update `Pipeline`-shaped test fixtures that break on the new required field (`v2/src/daemon/pipeline-execution.test.ts`, `v2/src/daemon/pipeline-stage-recovery.test.ts`, and any other whole-`Pipeline` literal typecheck flags) with `dismissedAt: null`.
- Delete the stale duplicate `v2/spec/ready-intents/dismissed-pipeline-durable-flag.md` — its content is superseded by this spec.
- Update `v2/docs/state-store.md`.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` test `a pre-027-migration database opens successfully and loads dismissedAt as null` — following the legacy-fixture pattern already in this file (`migration adds owner_identity to a pre-migration database without backfilling existing rows` at `v2/src/persistence/state-store.test.ts:382`, and `a pre-context-migration database opens successfully and loads legacy pipeline context as absent` at `:816`) — seeds a raw `pipelines` table without the `dismissed_at` column, inserts a pipeline row, opens that database through `openStateStore`, and asserts the existing pipeline loads with `dismissedAt: null` and no row loss; it fails against the pre-migration schema (the column does not exist to read).
- [ ] `v2/src/persistence/state-store.test.ts` test `dismissPipeline persists dismissedAt across reopen` fails against the pre-fix code, then proves a dismissed pipeline reads back a numeric `dismissedAt` at or after the pre-call clock reading from both `loadPipeline` and `listPipelines` after the store is closed and reopened on the same file.
- [ ] `v2/src/persistence/state-store.test.ts` test `undismissPipeline clears dismissedAt back to null` proves a dismiss followed by an undismiss reads back `dismissedAt: null`, and that the value is still `null` after close and reopen.
- [ ] `v2/src/persistence/state-store.test.ts` test `undismissPipeline on a never-dismissed pipeline is a no-op success` proves `undismissPipeline` called on a pipeline whose `dismissedAt` is already `null` returns `{ kind: "applied", pipelineId }` and `dismissedAt` still reads back `null`.
- [ ] `v2/src/persistence/state-store.test.ts` test `dismiss and undismiss only affect the targeted pipeline row` proves that with two pipelines A and B in the same store: dismissing A leaves B's `dismissedAt` at `null`; then dismissing B and undismissing A leaves B's `dismissedAt` unchanged (still set) while A's returns to `null`.
- [ ] `v2/src/persistence/state-store.test.ts` test `dismiss and undismiss leave stage records and pipeline lifecycle untouched` proves that dismissing and then undismissing a pipeline with a succeeded stage, a decided approval row, and a pending stage leaves every stage record byte-identical (`id`, `stageId`, `branchKey`, `position`, `status`, `workflowInvocationId`, `startedAt`, `endedAt`, `decidedAt`, `artifact`, `failureDetail`) and leaves the pipeline's `name`, `createdAt`, `definition`, `context`, `status`, `ownerIdentity`, `terminalPublicationFailure`, and `terminalPublicationSucceededAt` unchanged.
- [ ] `v2/src/persistence/state-store.test.ts` test `dismissPipeline and undismissPipeline refuse an unknown pipeline id` proves both operations return `{ kind: "refused", pipelineId: "no-such-pipeline", reason: "pipeline_not_found" }` and that a real pipeline in the same store is unchanged.
- [ ] `v2/src/persistence/state-store.test.ts` test `re-dismissing a dismissed pipeline preserves the first dismissal timestamp` proves that calling `dismissPipeline` on a row whose `dismissed_at` was seeded to a known past value returns `applied` and leaves that stored value intact.
- [ ] `v2/src/persistence/state-store.test.ts` — `dismissPipeline persists dismissedAt across reopen`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the dismiss write's `.run(Date.now(), args.pipelineId)` to `.run(null, args.pipelineId)` (baseline: `dismissed_at` is bound `NULL` on every dismiss call, so the column never leaves its initial `NULL` value — the dismissal is never recorded) turns this test red, while the `undismissPipeline clears dismissedAt back to null`, `re-dismissing a dismissed pipeline preserves the first dismissal timestamp`, and `dismissPipeline and undismissPipeline refuse an unknown pipeline id` tests stay green.
- [ ] `v2/src/persistence/state-store.test.ts` — `re-dismissing a dismissed pipeline preserves the first dismissal timestamp`; Mutation checkpoint: an in-body `// @mutate` directive dropping `AND dismissed_at IS NULL` from the dismiss write's `WHERE` clause lets a second dismiss overwrite the stored timestamp, turning this test red — proving the suppressed second write is genuinely suppressed rather than coincidentally equal.
- [ ] `v2/src/persistence/state-store.test.ts` — `dismiss and undismiss only affect the targeted pipeline row`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the dismiss write's `"UPDATE pipelines SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL"` to `"UPDATE pipelines SET dismissed_at = ? WHERE dismissed_at IS NULL"` (drops the `id` filter, so dismissing A also dismisses B) turns this test red.
- [ ] `v2/src/persistence/state-store.test.ts` — `dismiss and undismiss only affect the targeted pipeline row`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the undismiss write's `"UPDATE pipelines SET dismissed_at = NULL WHERE id = ?"` to `"UPDATE pipelines SET dismissed_at = NULL"` (drops the `id` filter, so undismissing A also clears B) turns this test red.
- [ ] `v2/src/persistence/state-store.test.ts` — `dismissPipeline and undismissPipeline refuse an unknown pipeline id`; Mutation checkpoint: an in-body `// @mutate` directive inverting the unknown-pipeline existence guard so it always reports the row present makes both operations return `applied` for a mistyped id, turning this test red.
- [ ] `v2/src/persistence/state-store.test.ts` — `undismissPipeline clears dismissedAt back to null`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the undismiss write's `SET dismissed_at = NULL WHERE id = ?` to `SET dismissed_at = dismissed_at WHERE id = ?` leaves the timestamp in place, turning this test red.
- [ ] The existing `pipelines`, `pipeline reconciliation`, `failed pipeline reopen`, and `terminal publication commits` blocks in `v2/src/persistence/state-store.test.ts` stay green, and `v2/src/persistence/state-store-on-disk.test.ts`, `v2/src/persistence/state-store-wal-open.test.ts`, and `v2/src/persistence/state-store-wal-concurrency.test.ts` stay green (schema addition is additive; no read, sweep, or migration path changes behavior).
- [ ] `v2/spec/ready-intents/dismissed-pipeline-durable-flag.md` no longer exists (superseded by this spec).
- [ ] `v2/docs/state-store.md` — the `pipelines` schema bullet records nullable `dismissed_at` (Unix epoch ms, `NULL` when not dismissed, set only by `dismissPipeline`), the forward-migration list gains `027-pipeline-dismissed-at` with its no-backfill note, and the API list gains `dismissPipeline` / `undismissPipeline` entries covering the `PipelineDismissalOutcome`/`PipelineDismissalRefusalReason` shape, the `pipeline_not_found` refusal, first-timestamp-preserving dismiss idempotence, unconditional-but-no-op undismiss on a never-dismissed pipeline, and that neither operation touches stage rows, other pipeline rows, or pipeline lifecycle columns.
- [ ] `v2/docs/state-store.md` records that the store does not filter on `dismissed_at`: `listPipelines` returns dismissed pipelines and `reconcilePipelines`/`claimPipelineContinuation` ignore the column, so a dismissed pipeline keeps executing and keeps being reconciled, and nothing in the store clears `dismissed_at` on a lifecycle transition; default-excluding projection is the daemon's concern.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — `pipelines` schema bullet (nullable `dismissed_at`), forward-migration list entry `027-pipeline-dismissed-at`, API entries for `dismissPipeline` / `undismissPipeline`, and the explicit no-filtering/no-lifecycle-clearing note.

## Implementer notes

- Suggested shape, keeping each guard independently quotable by one `@mutate` directive:

  ```ts
  export type PipelineDismissalRefusalReason = "pipeline_not_found";

  export type PipelineDismissalOutcome =
    | { kind: "applied"; pipelineId: string }
    | { kind: "refused"; pipelineId: string; reason: PipelineDismissalRefusalReason };

  private pipelineRowExists(pipelineId: string): boolean {
    return this.db.prepare("SELECT 1 FROM pipelines WHERE id = ?").get(pipelineId) !== null;
  }

  dismissPipeline(args: { pipelineId: string }): PipelineDismissalOutcome {
    if (!this.pipelineRowExists(args.pipelineId)) {
      return { kind: "refused", pipelineId: args.pipelineId, reason: "pipeline_not_found" };
    }
    this.db
      .prepare("UPDATE pipelines SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL")
      .run(Date.now(), args.pipelineId);
    return { kind: "applied", pipelineId: args.pipelineId };
  }

  undismissPipeline(args: { pipelineId: string }): PipelineDismissalOutcome {
    if (!this.pipelineRowExists(args.pipelineId)) {
      return { kind: "refused", pipelineId: args.pipelineId, reason: "pipeline_not_found" };
    }
    this.db.prepare("UPDATE pipelines SET dismissed_at = NULL WHERE id = ?").run(args.pipelineId);
    return { kind: "applied", pipelineId: args.pipelineId };
  }
  ```

  Directive anchors used above, each unique in `state-store.ts` under this shape and independently quotable: `.run(Date.now(), args.pipelineId)` (keystone — the dismiss write's bound values), `WHERE id = ? AND dismissed_at IS NULL` → `WHERE id = ?` (dismiss idempotence guard), the full dismiss `UPDATE` string (dismiss row-scoping guard), the full undismiss `UPDATE` string (undismiss row-scoping guard), `SET dismissed_at = NULL WHERE id = ?` (undismiss clear guard), and the `pipelineRowExists` return line → `return true;` (existence guard). Note `return row !== null;` already occurs once in this file (`loadPipelineStageAdmission` area) and `SELECT 1 FROM pipelines WHERE id = ?` also appears in `createPipelineStageBranch` with `args.pipelineId` — keep the new helper's body distinct so each quoted original matches exactly once.
- The timestamp-preservation test must not rely on two `Date.now()` calls landing in different milliseconds. Seed the prior value directly: open a second `new Database(TEST_DB_PATH)` handle (or reopen after `store.close()`), `UPDATE pipelines SET dismissed_at = 1000 WHERE id = ?`, then call `dismissPipeline` and assert the loaded value is still `1000`. Opening a second raw handle against the same on-disk path to seed state directly with SQL is an established idiom throughout this test file (e.g. the legacy-migration fixtures at `:382` and `:816`); it applies here the same way.
- The reopen assertion uses the existing fixture idiom: `store.close()`, then `openStateStore(TEST_DB_PATH)` on the same path, then `loadPipelineOrThrow`. Do not delete the store file between the two opens.
- Add no test-only inversion hooks; every directive must mutate the real store SQL or guard.
- The highest existing migration id is `026-attempts-completion-review-pass`; `027-pipeline-dismissed-at` follows it.
- Keep `dismissPipeline`/`undismissPipeline` adjacent to the terminal-publication commits in both the `StateStore` interface and `StateStoreImpl`, so the pipeline-row write ops stay together.
