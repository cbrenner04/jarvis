# Sweep incident JSON persistence

## Problem

`daemon-host.md` documents payload persistence on winning ledger inserts, but `deliverIncident` records key-only rows without `incident_json`, so pull queries cannot serve sweep-recorded deliveries.

## Decision ledger

- `deliverIncident` passes `incidentJson: serializeOperatorIncident(incident)` on every winning `tryRecordNotificationDelivery` (sink configured or not); rules out ledger rows the sweep records without `incident_json` that pull queries cannot serve.
- Failing-test surface drives a real sweep discharge, not direct ledger seeding; rules out ACs that only assert store helpers.

## Prerequisites

- Intent prerequisites: `StateStore.listDeliveredNotificationIncidents` supports `sinceCursor` / `sinceMs` and optional `kinds`.

## Task checklist

- Wire `deliverIncident` to persist `incidentJson` on winning ledger inserts (sink configured or not).
- Add `operator-notification-sweep.test.ts` regression that drives `runNotificationSweep` to record a delivery and asserts the persisted row has non-null `incident_json` matching the sink-shaped JSON; fails against the pre-fix key-only insert path.

## Acceptance criteria

- [ ] `v2/src/daemon/operator-notification-sweep.test.ts` test `sweep persists incident_json on winning delivery insert` drives a sweep discharge and asserts the ledger row carries non-null `incident_json` matching the serialized incident; it fails against the pre-fix `deliverIncident` path that omits `incidentJson`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 03.
