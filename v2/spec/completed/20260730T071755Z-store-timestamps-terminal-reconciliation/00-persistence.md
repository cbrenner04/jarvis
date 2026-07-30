# Persistence

## Problem

`beginRunReconciliation` moves orphan runs to `killed` or `interrupted` but records no finish
timestamp. Attempt `completed_at` is written only by `commitCompletionBoundary`. A reconciled run
with no committed attempt has no finish time; one killed after earlier completed iterations keeps the
last iteration's `completed_at`, not the reconciliation time.

## Decisions

- When `beginRunReconciliation` settles an orphan, stamp a reconciliation finish time at sweep
  write time; rules out leaving `killed`/`interrupted` rows without a durable finish timestamp and
  pushing the fix into list/TUI renderers.
- Prefer attempt `completed_at` when an `in-progress` attempt exists: set that row's `completed_at`
  without calling `commitCompletionBoundary` (no `outcome_kind`, no `attempt_count` bump, status
  unchanged); rules out a new run column when an open attempt can carry the timestamp.
- When no `in-progress` attempt exists, add nullable `runs.reconciled_at` via forward-only migration
  `015-run-reconciled-at` and set it at settlement; rules out fabricating attempt rows solely for a
  timestamp.
- When both prior completed attempts and an `in-progress` attempt exist, stamp only the
  `in-progress` attempt; the reconciliation finish time must be strictly later than every prior
  attempt `completed_at` already on the row (sweep-time `Date.now()` satisfies this in practice).
- Scope is `beginRunReconciliation` only; rules out changing `commitGuardedKill` or spawn-boundary
  failure capture in this slice.
- Settlement remains idempotent: rows already `killed`/`interrupted` are not candidates and receive
  no second stamp.
- Expose `reconciledAt` on the `Run` type and through `loadRun`/`listRuns`; attempt stamping is
  already visible on `Attempt.completedAt`.
- Deferred to first consumer: how daemon `list` derives `finishedAtMs` from `reconciledAt` versus
  attempt `completed_at` — pin when `list-row-step-honesty` wires the list row.

## Task checklist

- Add migration `015-run-reconciled-at`, map `reconciledAt` on `Run`, and stamp finish time inside
  `beginRunReconciliation`.
- Add focused coverage to `v2/src/persistence/state-store.test.ts` for in-progress-attempt stamping,
  `reconciled_at` fallback, stale-prior-attempt supersession, and `interrupted` review-debate rows.
- Update `v2/docs/state-store.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] After orphan settlement, a run with an `in-progress` attempt records a non-null
      `completed_at` on that attempt and leaves `outcome_kind` null, attempt `status`
      `in-progress`, `attempt_count` unchanged, and `reconciled_at` null.
- [x] After orphan settlement, a run with no attempts records non-null `reconciled_at` on the run row
      and no attempt rows.
- [x] After orphan settlement on a run with one or more completed attempts and no `in-progress`
      attempt, `reconciled_at` is non-null, every prior attempt `completed_at` is unchanged, and
      `reconciled_at` is strictly later than the maximum prior attempt `completed_at`.
- [x] After orphan settlement on a run with a completed prior attempt and a later `in-progress`
      attempt, the `in-progress` attempt's `completed_at` is greater than the prior attempt's
      `completed_at`.
- [x] A durable `review-debate` orphan with an open `in-progress` attempt settled `interrupted`
      stamps `completed_at` on that attempt (not `reconciled_at`), leaves attempt `status`
      `in-progress`, and leaves `reconciled_at` null.
- [x] After `reconciled_at` settlement, `loadRun` and a `listRuns` entry both return non-null
      `reconciledAt`.
- [x] A second reconciliation sweep, or a row already `killed`/`interrupted`, receives no additional
      finish-time stamp.
- [x] `v2/src/persistence/state-store.test.ts` regression
      `beginRunReconciliation stamps reconciliation finish time on orphaned runs` fails against the
      pre-change store and passes after implementation.
- [x] That regression fails if either the in-progress-attempt stamp guard or the `reconciled_at`
      fallback guard is removed; the no-attempt case proves no attempt row was fabricated.
- [x] `v2/src/daemon/daemon-reconciliation.test.ts` stays green (reconciliation status and event
      behavior unchanged by this slice).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — `reconciled_at` column, attempt-versus-run stamping precedence,
  non-boundary semantics (no `commitCompletionBoundary`), and idempotence; non-boundary attempt stamp
  (`completed_at` on an `in-progress` attempt with null `outcome_kind` is intentional, max-`completedAt`
  readers are the intended consumers, boundary semantics require `outcome_kind` or attempt status);
  dual-timestamp fallback rows (`reconciled_at` set while prior attempt `completed_at` values may
  remain stale — raw max-attempt readers must not treat attempt `completed_at` as authoritative when
  `reconciled_at` is set; list/TUI precedence is owned by `list-row-step-honesty`).
- `v2/docs/v1-behaviors.md` — orphan reconciliation records a finish timestamp on settled
  `killed`/`interrupted` runs.
