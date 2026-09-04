# Delivery ledger persists incident JSON

## Problem

`operator_notification_deliveries` stores only `(incidentId, transition, deliveredAt)`. Pull consumers cannot reconstruct the sink stdin JSON from the ledger row alone.

## Decision ledger

- Add nullable `incident_json` TEXT on `operator_notification_deliveries` in the baselined `SCHEMA` CREATE and via `addColumnIfMissing` on store open for stores that already stamped `031-baseline-squash`; rules out a PRIMARY KEY change or backfill of legacy rows.
- `tryRecordNotificationDelivery` accepts optional `incidentJson` (sink-serialized JSON string) and persists it on the winning insert; omitted or absent on a call leaves `incident_json` null; rules out upserting JSON onto an existing dedupe row.
- Persisted JSON is the same string shape `serializeOperatorIncident` produces today; rules out a second on-disk incident envelope or re-serialization at read time.
- Legacy key-only rows keep `incident_json` null; this subspec does not add list/query behavior; rules out backfill or re-derivation for pre-change ledger rows.
- Sweep discharge wiring to pass `incidentJson` is deferred to the daemon follow-on intent; this subspec proves the store round-trip via direct store calls; rules out coupling persistence land to daemon changes.

## Prerequisites

- Intent prerequisites: none.

## Task checklist

- Extend `operator_notification_deliveries` schema (`SCHEMA` + post-squash `addColumnIfMissing`) with nullable `incident_json`.
- Extend `tryRecordNotificationDelivery` args and INSERT to store `incident_json` when supplied.
- Add `state-store.test.ts` regression `notification delivery persists serialized incident JSON`: record a delivery with a full sink-shaped JSON payload via `tryRecordNotificationDelivery`, read the row back (direct SQL or a small test-only read helper), and assert `incident_json` round-trips the sink JSON shape; fails against the pre-fix key-only ledger.
- Update `state-store-baseline-migration.test.ts` fixture CREATE for `operator_notification_deliveries` when the baselined column list changes.

## Acceptance criteria

- [x] `v2/src/persistence/state-store.test.ts` test `notification delivery persists serialized incident JSON` records a delivery with a full incident payload and asserts the stored row round-trips the sink JSON shape; it fails against the pre-fix key-only ledger.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 02.
