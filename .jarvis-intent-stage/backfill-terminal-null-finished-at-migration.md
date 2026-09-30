---
name: backfill-terminal-null-finished-at-migration
---

# Stamped migration backfills terminal rows with null `finished_at`

## Problem

Existing durable terminal `runs` rows may still have `finished_at` null from the pre-fix completion-boundary fallback. Retention and incident derivation must not depend on `COALESCE` workarounds once new writes stamp the column.

## Decisions

- Add a one-shot stamped data-repair migration (same `_migrations` pattern as `032-completed-publication-failure-rows-to-failed`) that sets `finished_at` from `status_changed_at` where `status` is terminal and `finished_at` is null.
- Nonterminal rows and terminal rows that already have `finished_at` are untouched.

## Acceptance criteria

- [ ] A migration test (new file alongside `state-store-publication-failure-migration.test.ts` or equivalent) proves terminal rows with null `finished_at` are backfilled from `status_changed_at` and nonterminal rows are untouched; it fails before the migration exists.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — document the stamped backfill under **Stamped-baseline data repair**.

## Prerequisites

- Terminal `commitCompletionBoundary` writes stamp `finished_at` when settlement evidence is absent.
- Stamped baseline data-repair migrations run after `applySchemaMigrations` on store open.
