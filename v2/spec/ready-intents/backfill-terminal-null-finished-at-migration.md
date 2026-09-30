---
name: backfill-terminal-null-finished-at-migration
---

# Stamped migration backfills terminal rows with null `finished_at`

## Problem

Existing durable terminal `runs` rows may still have `finished_at` null from the pre-fix completion-boundary fallback. Retention and incident derivation must not depend on `COALESCE` workarounds once new writes stamp the column.

## Decisions

- Add a one-shot stamped data-repair migration (same `_migrations` pattern as `032-completed-publication-failure-rows-to-failed`) that sets `finished_at` from `COALESCE(status_changed_at, created_at)` where `status` is terminal and `finished_at` is null (same best-known time semantics as `listIncidentCandidateRuns`).
- Nonterminal rows and terminal rows that already have `finished_at` are untouched.
- Same stamped contract as `032`: fixed migration id in `_migrations`, idempotent second store open, pre-squash store backfilled in one open when only pre-baseline ids are stamped.

## Acceptance criteria

- [ ] A migration test alongside `state-store-publication-failure-migration.test.ts` proves terminal null `finished_at` rows backfill from `COALESCE(status_changed_at, created_at)`, nonterminal rows stay untouched, `_migrations` records the migration id with a no-op second open, and a pre-squash stamped store repairs in one open; it fails before the migration exists.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — document the stamped backfill under **Stamped-baseline data repair**.
- `v2/docs/v1-behaviors.md` — parity note for stamped upgrade backfill of terminal null `finished_at` (cf. migration `032`).

## Prerequisites

- Terminal `commitCompletionBoundary` writes stamp `finished_at` when settlement evidence is absent.
- Stamped baseline data-repair migrations run after `applySchemaMigrations` on store open.
