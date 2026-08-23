# Durable run dismissal column and store operations

## Problem

The `runs` table (`v2/src/persistence/state-store.ts`) carries identity, lifecycle, checkpoint, and publication columns — nothing an operator can set to mark a run dismissed, and no store operation to set or clear such a mark. The daemon `list` projection, `jarvis run list`, and the TUI work tree therefore repaint every dead terminal run until it ages out of the daemon's 50-newest terminal-retention window, with no durable way to hide one.

The three consumer intents (`dismiss-run-rpc`, `dismiss-run-cli`, `dismiss-run-tui-display`) each list this store behavior under `## Prerequisites`; none can land until a run row holds a dismissal timestamp that survives a daemon restart. The pipeline side already shipped the same shape (`dismissed_at` on `pipelines`, migration `027-pipeline-dismissed-at`, `dismissPipeline`/`undismissPipeline`, `PipelineDismissalOutcome`) — this subspec mirrors it onto runs.

## Decision ledger

- Dismissal is a nullable `dismissed_at` INTEGER column on `runs`, added by forward migration `028-run-dismissed-at` with no backfill (pre-migration rows read `null`) — rules out a process-local or in-memory flag, which would evaporate on daemon restart, exactly the case an operator dismisses a run to survive.
- `dismissRun` / `undismissRun` return `RunDismissalOutcome` (`{ kind: "applied"; runId }` | `{ kind: "refused"; runId; reason: RunDismissalRefusalReason }`, with `RunDismissalRefusalReason = "run_not_found"`), mirroring `PipelineDismissalOutcome` — rules out `recordAttemptStart`'s throw-on-unknown-id idiom, which would force the daemon handler to try/catch to produce its own named refusal. Naming the reason union (rather than inlining the string) is what the RPC consumer intent imports.
- Both take a positional `runId: string`, not an args object — rules out copying `dismissPipeline({ pipelineId })`'s object form; every single-id run operation in this file (`setRunStatus`, `commitGuardedKill`, `setReadyGatePgid`, `recordAttemptStart`) is positional, and parity with the pipeline pair is about the outcome shape, not the call shape.
- Dismiss preserves the first dismissal timestamp: the write is guarded `WHERE id = ? AND dismissed_at IS NULL`, mirroring `dismissPipeline` — rules out an unconditional overwrite, under which re-dismissing would move the timestamp and "idempotent no-op" would be false.
- Undismiss writes `NULL` unconditionally on a known row and reports `applied` — rules out a symmetric `IS NOT NULL` guard, which would need a second refusal reason for the already-undismissed case with no consumer asking for one.
- Both operations write only `runs.dismissed_at`, scoped to the targeted row by `id`: no other run's `dismissed_at` changes, and no attempt rows, `status`, `attempt_count`, `workflow_snapshot`, `finished_at`, `reconciled_at`, or publication columns change on any row — rules out reusing the kill or reconciliation path, which would couple an operator's display choice to run lifecycle.
- `dismissedAt` rides `RUN_COLUMNS` and flows through `mapRunRow`'s existing row spread, so `loadRun`, `listRuns`, and `findRunByProjectBranch` all expose it — rules out an out-of-band second lookup for the daemon projection.
- `dismissedAt?: number | null` is optional on `Run`, like its nullable siblings `finishedAt`, `reconciledAt`, and `readyGatePgid` — rules out the required form used on `Pipeline`; `Run` fakes across the daemon and TUI tests construct partial run literals, and a required field would churn them for no durable gain.
- The store never filters on `dismissed_at`: `listRuns`, `loadRun`, `findRunByProjectBranch`, and the orphan/reconciliation sweeps are untouched, so a dismissed run stays loadable by id, keeps executing, and keeps being reconciled — rules out store-level filtering, which would hide rows from the restart sweep and silently strand live work. Default-excluding projection and the terminal-retention interaction belong to the daemon (`dismiss-run-rpc`). Symmetrically, nothing in the store clears `dismissed_at` on a lifecycle transition — a resumed or reconciled run stays dismissed.
- Dismissal never deletes the durable row and is not an early eviction from any retention window — rules out implementing dismissal as a row delete or as a retention-slot mutation.
- `v2/docs/v1-behaviors.md` is not touched: this subspec is purely additive and changes no existing behavior. The parity-baseline edit belongs to `dismiss-run-rpc`, where `list` stops returning every retained run by default.
- The outcome shape carries only `kind`/`runId`/`reason`, no run status: the daemon (`dismiss-run-rpc`) already holds and projects the run row it's acting on, so it sources status from that row rather than a second lookup — rules out widening `RunDismissalOutcome` to duplicate status the caller already has.
- The existence probe and the write are two separate statements, not one transaction: `applied`/`refused` reflects the row's existence at the moment of the probe, matching the pipeline pair under the daemon's single-writer model — rules out treating the gap as an oversight rather than a stated non-atomicity.

## Task checklist

- Add migration `{ id: "028-run-dismissed-at", up: "ALTER TABLE runs ADD COLUMN dismissed_at INTEGER" }` to `SCHEMA_MIGRATIONS`.
- Add `dismissed_at AS dismissedAt` to `RUN_COLUMNS` and `dismissedAt?: number | null` to `Run`.
- Add `RunDismissalRefusalReason`, `RunDismissalOutcome`, and `dismissRun` / `undismissRun` to the `StateStore` interface and `StateStoreImpl`, next to `setRunStatus` / `commitGuardedKill` so run-row writes stay together.
- Add the tests below to `v2/src/persistence/state-store.test.ts` with in-body `// @mutate` directives on the real store guards.
- Update `v2/docs/state-store.md`.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` test `a pre-migration database migrates dismissed_at onto existing runs as null` — following the legacy-fixture pattern already in this file (`migration adds owner_identity to a pre-migration database without backfilling existing rows` at `v2/src/persistence/state-store.test.ts:382`) — seeds a raw `runs` table without the `dismissed_at` column, inserts a run row, opens that database through `openStateStore`, then opens a second raw handle on the same file and asserts the migrated `runs` table now has a queryable `dismissed_at` column reading `NULL` for that row, and separately asserts the run loaded through the store reads `dismissedAt` as strictly `null` (`toBeNull()`, not merely absent); it fails against the pre-migration schema, where neither the column nor a coerced `null` projection exists (today `RUN_COLUMNS` omits `dismissed_at` and `mapRunRow` spreads the row without coercion, so a pre-fix load already yields `dismissedAt: undefined` — a `null-or-absent` assertion would pass on that baseline, which is why this criterion pins the stricter `toBeNull()` shape instead).
- [ ] `v2/src/persistence/state-store.test.ts` test `dismissRun persists dismissedAt across reopen` fails against the pre-fix code, then proves a dismissed run reads back a numeric `dismissedAt` at or after the pre-call clock reading from both `loadRun` and `listRuns` after the store is closed and reopened on the same file.
- [ ] `v2/src/persistence/state-store.test.ts` test `undismissRun clears dismissedAt back to null` proves a dismiss followed by an undismiss reads back `dismissedAt: null`, and that the value is still `null` after close and reopen.
- [ ] `v2/src/persistence/state-store.test.ts` test `undismissRun on a never-dismissed run is a no-op success` proves `undismissRun` called on a run whose `dismissedAt` is already null returns `{ kind: "applied", runId }` and `dismissedAt` still reads back null.
- [ ] `v2/src/persistence/state-store.test.ts` test `re-dismissing a dismissed run preserves the first dismissal timestamp` proves that calling `dismissRun` on a row whose `dismissed_at` was seeded to a known past value returns `applied` and leaves that stored value intact.
- [ ] `v2/src/persistence/state-store.test.ts` test `dismiss and undismiss only affect the targeted run row` proves that with two runs A and B in the same store: dismissing A leaves B's `dismissedAt` null; then dismissing B and undismissing A leaves B's `dismissedAt` unchanged (still set) while A's returns to null.
- [ ] `v2/src/persistence/state-store.test.ts` test `dismiss and undismiss leave run status attempts and workflow snapshot untouched` proves that dismissing and then undismissing a workflow-backed run with a completed attempt leaves `status`, `attemptCount`, `workflowSnapshot`, `stepId`, `finishedAt`, `reconciledAt`, `prNumber`, `prUrl`, `worktreePath`, `branch`, and every attempt row (`id`, `attemptNumber`, `startedAt`, `status`, `outcomeKind`, `completedAt`) unchanged.
- [ ] `v2/src/persistence/state-store.test.ts` test `dismissRun and undismissRun refuse an unknown run id` proves both operations return `{ kind: "refused", runId: "no-such-run", reason: "run_not_found" }` and that a real run in the same store is unchanged.
- [ ] `v2/src/persistence/state-store.test.ts` test `a dismissed run stays loadable and keeps its lifecycle` proves a dismissed in-progress run is still returned by `loadRun`, by `listRuns`, and by `findRunByProjectBranch`, and that a dismissed orphan run is still swept by `beginRunReconciliation`, using the `describe("pipeline reconciliation")` block's `openSweepStore`/`seedOrphanRun`/`OwnerLivenessProbe` fixture (a separate describe block from the `seedRun`/`loadRunOrThrow` helpers) to seed and sweep the orphaned run; this is a scope-boundary proof, not the subspec's required failing-test AC — the reopen-persistence criterion above carries that obligation.
- [ ] `v2/src/persistence/state-store.test.ts` — `dismissRun persists dismissedAt across reopen`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the dismiss write's `.run(dismissedAt, runId)` to `.run(null, runId)` (baseline: `dismissed_at` is bound `NULL` on every dismiss call, so the column never leaves its initial `NULL` value — the dismissal is never recorded) turns this test red.
- [ ] `v2/src/persistence/state-store.test.ts` — `re-dismissing a dismissed run preserves the first dismissal timestamp`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the dismiss write's `"UPDATE runs SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL"` to `"UPDATE runs SET dismissed_at = ? WHERE id = ?"` lets a second dismiss overwrite the stored timestamp, turning this test red — proving the suppressed second write is genuinely suppressed rather than coincidentally equal.
- [ ] `v2/src/persistence/state-store.test.ts` — `dismiss and undismiss only affect the targeted run row`; Mutation checkpoint: two in-body `// @mutate` directives on this one test. First, the dismiss write's `"UPDATE runs SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL"` rewritten to `"UPDATE runs SET dismissed_at = ? WHERE (id = ? OR 1 = 1) AND dismissed_at IS NULL"` — this keeps both bound placeholders (so the statement still executes instead of throwing on bind arity), leaves the idempotency guard intact, and only neuters the `id` scoping, so dismissing A also dismisses B. Second, the undismiss write's `"UPDATE runs SET dismissed_at = NULL WHERE id = ?"` rewritten to `"UPDATE runs SET dismissed_at = NULL"` (drops the `id` filter, so undismissing A also clears B). Either directive alone turns this test red.
- [ ] `v2/src/persistence/state-store.test.ts` — `undismissRun clears dismissedAt back to null`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the undismiss write's `"UPDATE runs SET dismissed_at = NULL WHERE id = ?"` to `"UPDATE runs SET dismissed_at = dismissed_at WHERE id = ?"` leaves the timestamp in place, turning this test red.
- [ ] `v2/src/persistence/state-store.test.ts` — `dismissRun and undismissRun refuse an unknown run id`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the run-existence guard's `return this.db.prepare("SELECT 1 FROM runs WHERE id = ?").get(runId) !== null;` to `return true;` makes both operations return `applied` for a mistyped id, turning this test red.
- [ ] The existing `StateStore`, `commitGuardedKill`, and reconciliation blocks in `v2/src/persistence/state-store.test.ts` stay green, and `v2/src/persistence/state-store-on-disk.test.ts`, `v2/src/persistence/state-store-wal-open.test.ts`, and `v2/src/persistence/state-store-wal-concurrency.test.ts` stay green (schema addition is additive; no read, sweep, or migration path changes behavior).
- [ ] `v2/docs/state-store.md` — the `runs` schema bullet records nullable `dismissed_at` (Unix epoch ms, `NULL` when not dismissed, set only by `dismissRun` and cleared only by `undismissRun`), the forward-migration list gains `028-run-dismissed-at` with its no-backfill note, and the API list gains `dismissRun` / `undismissRun` entries covering the `RunDismissalOutcome`/`RunDismissalRefusalReason` shape, the `run_not_found` refusal, first-timestamp-preserving dismiss idempotence, unconditional-but-no-op undismiss on a never-dismissed run, and that neither operation touches attempt rows, other run rows, or run lifecycle columns — noting parity with the `dismissPipeline`/`undismissPipeline` pair.
- [ ] `v2/docs/state-store.md` records that the store does not filter on `runs.dismissed_at`: `listRuns`, `loadRun`, and `findRunByProjectBranch` return dismissed runs and the reconciliation/orphan sweeps ignore the column, so a dismissed run keeps executing and keeps being reconciled; nothing in the store clears `dismissed_at` on a lifecycle transition; dismissal never deletes the durable row; and default-excluding projection plus the terminal-retention interaction are the daemon's concern.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — `runs` schema bullet (nullable `dismissed_at`), forward-migration list entry `028-run-dismissed-at`, API entries for `dismissRun` / `undismissRun` with pipeline-pair parity, and the explicit no-filtering / no-lifecycle-clearing / no-row-deletion note.

## Implementer notes

- Suggested shape, keeping each guard independently quotable by one `@mutate` directive:

  ```ts
  export type RunDismissalRefusalReason = "run_not_found";

  export type RunDismissalOutcome =
    | { kind: "applied"; runId: string }
    | { kind: "refused"; runId: string; reason: RunDismissalRefusalReason };

  private runRowExists(runId: string): boolean {
    return this.db.prepare("SELECT 1 FROM runs WHERE id = ?").get(runId) !== null;
  }

  dismissRun(runId: string): RunDismissalOutcome {
    if (!this.runRowExists(runId)) {
      return { kind: "refused", runId, reason: "run_not_found" };
    }
    const dismissedAt = Date.now();
    this.db.prepare("UPDATE runs SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL").run(dismissedAt, runId);
    return { kind: "applied", runId };
  }

  undismissRun(runId: string): RunDismissalOutcome {
    if (!this.runRowExists(runId)) {
      return { kind: "refused", runId, reason: "run_not_found" };
    }
    this.db.prepare("UPDATE runs SET dismissed_at = NULL WHERE id = ?").run(runId);
    return { kind: "applied", runId };
  }
  ```

  Each quoted original above occurs exactly once under this shape. `SELECT 1 FROM runs WHERE id = ?` alone already appears in `recordAttemptStart` and the full `runRowExists` return line is the unique anchor; the bare `if (!this.runRowExists(runId)) {` line appears twice (once per operation) and is **not** a usable anchor. The pipeline pair's strings differ (`pipelines`, `args.pipelineId`) so they do not collide.
- `mapRunRow` spreads the remaining row fields, so adding `dismissed_at AS dismissedAt` to `RUN_COLUMNS` plus the `Run` field is enough to project it — no mapper change, and `RunRow` derives from `Run`.
- The timestamp-preservation test must not rely on two `Date.now()` calls landing in different milliseconds. Seed the prior value directly: open a second `new Database(TEST_DB_PATH)` handle, `UPDATE runs SET dismissed_at = 1000 WHERE id = ?`, then call `dismissRun` and assert the loaded value is still `1000`. Opening a second raw handle against the same on-disk path to seed state with SQL is an established idiom in this test file (e.g. `:654`, `:785`).
- The reopen assertion uses the existing fixture idiom: `store.close()`, then `openStateStore(TEST_DB_PATH)` on the same path, then `loadRunOrThrow`. Do not delete the store file between the two opens.
- Use the file's `seedRun` helper (`:52`) for run fixtures and `loadRunOrThrow` (`:63`) for assertions; `createRun` accepts `stepId` and `workflowSnapshot` overrides for the lifecycle-untouched test.
- The legacy-fixture test hand-builds `runs`/`attempts`/`_migrations` at an early schema shape and stamps only the migration ids that would otherwise collide with those hand-built columns — migration application rethrows after rollback on `duplicate column name`, so stamping every migration id is not an option. Copy this pattern rather than rediscovering it.
- The reconciliation-sweep fixture (`openSweepStore`, `seedOrphanRun`, `OwnerLivenessProbe`) lives in the `describe("pipeline reconciliation")` block starting at `v2/src/persistence/state-store.test.ts:1831`, not next to `seedRun`/`loadRunOrThrow`; the lifecycle-boundary criterion needs it for the orphan-sweep half of its assertion.
- Add no test-only inversion hooks; every directive must mutate the real store SQL or guard.
- The highest existing migration id is `027-pipeline-dismissed-at`; `028-run-dismissed-at` follows it.
