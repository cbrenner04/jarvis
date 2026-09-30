# Backfill terminal `runs` rows with null `finished_at`

Pre-fix `commitCompletionBoundary` could leave terminal rows with `finished_at` null while `listIncidentCandidateRuns` still bounded them via `COALESCE(finished_at, status_changed_at, created_at)`. New writes stamp `finished_at`; durable rows need a one-shot stamped repair so retention and incident derivation do not depend on that COALESCE forever.

## Decisions

- Add `repairTerminalNullFinishedAt` in `v2/src/persistence/state-store.ts`, invoked from the `StateStore` constructor immediately after `repairCompletedPublicationFailureRows` (same placement pattern as `032`, not inside `applySchemaMigrations`).
- `_migrations` id is `033-terminal-null-finished-at-backfill`; skipped once stamped; apply the update and stamp in one transaction.
- Predicate: `status` in `TERMINAL_RUN_STATUSES` and `finished_at IS NULL`; set `finished_at = COALESCE(status_changed_at, created_at)` only — rules out backfilling nonterminal rows or overwriting an existing `finished_at`.
- Nonterminal rows and terminal rows that already have `finished_at` are left unchanged; other columns are untouched.
- Pre-squash stores (legacy `_migrations` ids only) upgrade through `applySchemaMigrations` and run this repair in the same open as `031-baseline-squash` and `032`, matching the `032` stamped contract.
- Second `openStateStore` after the stamp is a no-op even if new matching rows appear later (same idempotency contract as `state-store-publication-failure-migration.test.ts`).

## Tasks

- [ ] Implement `repairTerminalNullFinishedAt` and wire it in the constructor after `repairCompletedPublicationFailureRows`.
- [ ] Add `v2/src/persistence/state-store-terminal-null-finished-at-migration.test.ts` beside `state-store-publication-failure-migration.test.ts` (raw SQLite seed, `openStateStore` reopen assertions).
- [ ] Update `v2/docs/state-store.md` and `v2/docs/v1-behaviors.md` per documentation updates below.

## Acceptance criteria

- [x] `state-store-terminal-null-finished-at-migration.test.ts` seeds a store stamped `031-baseline-squash` with terminal rows (`finished_at` null, varied `status_changed_at` / `created_at`), nonterminal rows, and terminal rows with `finished_at` already set; one open backfills only the null-terminal rows from `COALESCE(status_changed_at, created_at)`, records `033-terminal-null-finished-at-backfill` in `_migrations`, and a second open is a no-op; it fails against the pre-fix code.
- [x] The same test file seeds a pre-squash store (only pre-baseline `_migrations` ids) and asserts one `openStateStore` leaves `031-baseline-squash`, `032-completed-publication-failure-rows-to-failed`, and `033-terminal-null-finished-at-backfill` stamped with terminal null `finished_at` rows repaired.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — under **Stamped-baseline data repair**, document migration `033-terminal-null-finished-at-backfill` (predicate, `COALESCE` source, idempotency, pre-squash one-open behavior) as a sibling bullet to `032`.
- `v2/docs/v1-behaviors.md` — parity note that upgrade backfills terminal null `finished_at` from `COALESCE(status_changed_at, created_at)` (cf. migration `032`).
