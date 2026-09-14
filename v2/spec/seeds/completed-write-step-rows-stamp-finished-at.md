---
name: completed-write-step-rows-stamp-finished-at
---

# Plan write-step rows settle `completed` with `finished_at` NULL

## Problem

Workflow write steps that defer publication (`publishCompletion: false`) settle their row `completed` through a path that sets `status` and `status_changed_at` but leaves `finished_at` NULL. Every other terminal row carries it. Any consumer keying "still running" or retention/expiry on `finished_at` misreads these rows: cleanup's session-log retention preserves rows with a null `finished_at` forever, and incident candidate queries fall back to other timestamps.

## Evidence (2026-09-14)

`runs` rows for plan write steps `dc2f54a1` (`plan/remove-client-daemon-socket-discovery`) and `576c67ce` (`plan/retire-digest-daemon-artifacts`): `status = completed`, `finished_at = NULL`, `status_changed_at` set; their sibling `review-debate` rows have `finished_at` set.

## Decisions

- Every write into a terminal status stamps `finished_at` in the same statement, regardless of settlement path.
- Backfill existing terminal rows with a null `finished_at` from `status_changed_at` in a migration.

## Acceptance criteria

- [ ] A test proves a workflow write step settled `completed` with `publishCompletion: false` records a non-null `finished_at`; it fails against the pre-fix settlement.
- [ ] A migration test proves terminal rows with null `finished_at` are backfilled from `status_changed_at` and non-terminal rows are untouched.

## Documentation updates

- `v2/docs/state-store.md` — terminal rows always carry `finished_at`.
