# Migrate `completed` rows with a publication-failure cause to `failed`

PR #4088 settles publication-tail failures `failed`; rows written before it still read `completed` with a failure `terminal_cause`. A one-shot state-store migration in `v2/src/persistence/state-store.ts` repairs them.

## Decisions

- The migration is a separate step called from the `StateStore` constructor right after `applySchemaMigrations`, not inside it: `applySchemaMigrations` returns early for stores stamped `031-baseline-squash`, which hold the bad rows; not folded into `upgradeFromLegacyEra` for the same reason.
- `_migrations` id is `032-completed-publication-failure-rows-to-failed`; it runs after `031-baseline-squash` is stamped, so a pre-squash store is upgraded and repaired in one open. It is skipped once stamped.
- Predicate: `status = 'completed' AND terminal_cause IN ('completion_commit_failed', 'ready_flip_failed')`; not every non-`complete` cause, because `writeTerminalSettlementEvidence` leaves `terminal_cause` untouched when a settlement omits it, so a resumed run that genuinely completed can keep a stale cause such as `ready_gate_failed`. This narrows the intent's "neither `complete` nor null" wording to the two causes #4088 reclassified.
- Rewrite `status` only; `terminal_cause`, `terminal_failure_detail`, `finished_at`, `status_changed_at`, and other columns keep their values, so cause-keyed resume/incident derivation still reads them.
- Repaired rows are not suppressed from notification: incident derivation is bounded by `finished_at` recency (`ATTENTION_TERMINAL_RECENCY_MS`), and `finished_at` is unchanged, so repaired rows older than the window derive no incident; an in-window row derives one `failed` incident, which is correct for a failure previously misreported as `completed`.
- `pipeline_stages` rows are out of scope; only `runs` rows are rewritten.
- Apply the update and the `_migrations` stamp in one transaction; skip the update when `runs.terminal_cause` is absent.

## Tasks

- [x] Add the migration step to `state-store.ts`, called from the constructor after `applySchemaMigrations`.
- [x] Add a migration test in `v2/src/persistence/` seeding rows via raw SQLite, reopening via `openStateStore`, and asserting results.

## Acceptance criteria

- [x] A new migration test seeds a store stamped `031-baseline-squash` with `completed` rows carrying `completion_commit_failed` and `ready_flip_failed` causes, reopens it, and asserts both read `failed` with `terminal_cause`, `terminal_failure_detail`, `finished_at`, and `status_changed_at` unchanged; it fails against the pre-fix code.
- [x] The same test asserts `completed` rows with `terminal_cause` `complete`, null, or `ready_gate_failed`, and non-`completed` rows with a failure cause, are untouched, that `_migrations` holds `032-completed-publication-failure-rows-to-failed`, and that reopening a second time is a no-op.
- [x] A test seeds a pre-squash store (legacy `_migrations` ids, misclassified `completed` row) and asserts one open leaves it stamped `031-baseline-squash` and `032-completed-publication-failure-rows-to-failed` with the row `failed`.
- [x] `a repaired row derives a failed-state incident in window and none once stale` asserts `deriveOperatorIncidents` returns no incident for a repaired row whose `finished_at` is older than the recency window, and that the in-window incident reflects the repaired state — `cause: "failed"` and transition `terminal:failed:<statusChangedAt>`, since the incident's `cause` mirrors the row status; it fails against the pre-fix code, which leaves the row `completed` and derives `cause: "completed"`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md`: note the migration id and what it rewrites in the "Stamped-baseline column repair" paragraph's neighborhood, as a sibling paragraph on the stamped-baseline data repair.
- `v2/docs/v1-behaviors.md`: record that pre-existing `completed` rows with `completion_commit_failed` or `ready_flip_failed` now read `failed` after upgrade.
