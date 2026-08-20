---
name: dismissed-pipeline-durable-flag
---

# Dismissed Pipeline Durable Flag

## Prerequisites

## Surface

Persistence.

## Problem

- The state store has no way to record that the operator no longer wants a pipeline painted; `status` and derived state are lifecycle facts, so hiding a pipeline today would mean deleting or mutating its record.

## Behavior

- A pipeline carries a nullable durable dismissal timestamp: dismissing sets it, undismissing clears it, both are idempotent, and reopening the store preserves the value.

## Decisions

- Store dismissal as a nullable `dismissed_at` timestamp on `pipelines` via an appended ledgered migration, surfaced as `dismissedAt` on the loaded and listed pipeline; rules out a separate table and rules out overloading `status`, which already carries ownership/lifecycle meaning.
- Dismiss and undismiss touch only that column — no stage rows, no `status`, no derived state; rules out coupling dismissal to reject/kill.
- Dismissing an unknown pipeline id is refused rather than silently no-op; rules out a typo reporting success.
- `listPipelines` keeps returning every pipeline and reports `dismissedAt`; filtering belongs to callers. Rules out a store-level default filter that would hide rows from reconciliation and recovery sweeps.

## Required verification

- A state-store test dismisses a pipeline, reopens the store on the same path, and asserts `dismissedAt` survives; it fails against the pre-fix store.
- A state-store test asserts undismiss clears the timestamp and that dismiss/undismiss leave stage records, `status`, and derived state untouched.
- A migration test opens a pre-migration fixture database and asserts existing pipelines read back with `dismissedAt` null and no row loss.

## Documentation updates

- `v2/docs/state-store.md` — the `dismissed_at` column, its migration, the dismiss/undismiss store operations, and that `listPipelines` stays unfiltered.
