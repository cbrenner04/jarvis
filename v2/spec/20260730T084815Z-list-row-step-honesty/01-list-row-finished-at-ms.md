# List row finish time

## Prerequisites

- Store terminal reconciliation records `reconciledAt` on killed/interrupted runs
  (`v2/spec/20260730T071755Z-store-timestamps-terminal-reconciliation`) is merged before
  this subspec runs.

## Problem

`runListFinishedAtMs` (`daemon.ts:670-679`) derives `finishedAtMs` only from attempt
`completed_at`. Reconciled terminal runs whose finish time lives on `reconciled_at` (per
`20260730T071755Z-store-timestamps-terminal-reconciliation`) omit `finishedAtMs` on
`list`, so the TUI terminal window and sort order cannot see when those runs settled once
the sibling `terminal-window-renders-finishless-rows` consumes it.

## Decisions

- For terminal list rows, `finishedAtMs` is the latest finish timestamp on the run row:
  the maximum of non-null attempt `completed_at` values and non-null `reconciledAt`;
  rules out attempt-only readers that ignore reconciliation settlement.
- When `reconciledAt` is set, it participates in that maximum even if prior attempt
  `completed_at` values are stale; rules out treating max attempt time as authoritative
  when the store recorded a later reconciliation finish.
- Non-terminal rows still omit `finishedAtMs`; rules out exposing finish time while a
  run is live or queued.
- Deferred to first consumer: TUI policy for terminal rows that still lack any finish
  timestamp after this change — owned by `terminal-window-renders-finishless-rows`.

## Task checklist

- Extend `runListFinishedAtMs` (or `buildRunListRow` assembly) to fold `reconciledAt`
  into the terminal finish timestamp.
- Add focused list coverage for a reconciled `killed` or `interrupted` row with
  `reconciledAt` set and no attempt `completed_at`.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [ ] `daemon-start-list.test.ts` test `list sets finishedAtMs from reconciledAt when terminal row has no attempt completed_at` asserts `finishedAtMs` equals the run row's `reconciledAt`; it fails against baseline and passes after implementation.
- [ ] The reconciledAt-only regression fails if `reconciledAt` is excluded from the
  finish-time maximum (guard inversion).
- [ ] `daemon-start-list.test.ts` test `list sets finishedAtMs to later reconciledAt when attempt completed_at is stale` asserts `finishedAtMs` equals `reconciledAt`; it fails against baseline and passes after implementation.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `finishedAtMs` derivation includes `reconciledAt` for
  terminal rows.
- `v2/docs/v1-behaviors.md` — list `finishedAtMs` honors store reconciliation finish time.
