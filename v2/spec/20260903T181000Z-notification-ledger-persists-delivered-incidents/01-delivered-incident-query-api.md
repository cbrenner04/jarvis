# Delivered-incident query API

## Problem

No store operation returns delivered incidents for pull catch-up. Consumers cannot resume from a cursor or read a delivery recorded while no waiter was armed without re-deriving unbounded durable state.

## Decision ledger

- Add `listDeliveredNotificationIncidents` on `StateStore` returning sink-shaped incident objects parsed from stored `incident_json`, ordered by `(delivered_at ASC, incident_id ASC, transition ASC)`; rules out CLI or daemon reading sqlite ad hoc.
- Query args accept exactly one lower bound: `sinceCursor` (colon-delimited `deliveredAt:incidentId:transition`) or `sinceMs` (Unix epoch ms inclusive on `delivered_at`); rules out combining both bounds in one call.
- Optional `kinds` filters on `kind` inside stored JSON; omitted means all kinds; rules out daemon-side filtering after an unbounded load.
- Rows with `incident_json IS NULL` are excluded from query results; rules out serving legacy key-only ledger rows to pull consumers.
- Consumer cursor wire form is `deliveredAt:incidentId:transition`; export encode/decode helpers at the store boundary for daemon RPC and CLI `--since` reuse; rules out line-offset, file-position, or opaque blob cursors.
- `sinceCursor` lower bound is inclusive on the `(delivered_at, incident_id, transition)` tuple; rules out timestamp-only cursors that collide across incidents sharing a `delivered_at`.
- Deferred to first consumer: exact `--since` duration literal grammar — pin when CLI admission lands.

## Prerequisites

- Subspec 00: `tryRecordNotificationDelivery` persists `incident_json` and the baselined schema includes the column.

## Task checklist

- Implement `listDeliveredNotificationIncidents` with `sinceCursor` / `sinceMs` and optional `kinds` per the decision ledger.
- Export cursor wire encode/decode helpers shared by the query boundary.
- Add `state-store.test.ts` regression `list delivered notification incidents honors since cursor`: seed multiple delivered rows with distinct cursors (including one legacy null-json row), query with a middle cursor, and assert only rows at or after that cursor return in stable order with legacy rows absent; fails against the pre-fix absent query API.
- Add `state-store.test.ts` regression `delivered incident is readable after recording with no active consumer`: record a delivery with incident JSON, query with a prior cursor, and assert the incident is returned; fails against the pre-fix ledger that cannot serve pull catch-up.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` test `list delivered notification incidents honors since cursor` seeds multiple delivered rows and asserts the query returns only rows at or after the cursor in stable order; it fails against the pre-fix absent query API.
- [ ] `v2/src/persistence/state-store.test.ts` test `delivered incident is readable after recording with no active consumer` records a delivery then queries with a prior cursor and asserts the incident is returned; it fails against the pre-fix ledger that cannot serve pull catch-up.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspecs 02 and 03.
