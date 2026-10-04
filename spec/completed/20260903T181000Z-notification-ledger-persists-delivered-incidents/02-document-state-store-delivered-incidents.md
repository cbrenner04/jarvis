# Document state-store delivered incidents

## Problem

`v2/docs/state-store.md` documents the key-only delivery ledger and omits `incident_json`, the delivered-incident query, and cursor wire form.

## Decision ledger

- `state-store.md` is the durable home for `operator_notification_deliveries` schema, `listDeliveredNotificationIncidents`, and cursor helpers; rules out duplicating store query SQL in `daemon-host.md`.

## Prerequisites

- Subspecs 00–01: `incident_json` persistence and `listDeliveredNotificationIncidents` are observable on `StateStore`.

## Task checklist

- Update `v2/docs/state-store.md` schema bullet for `operator_notification_deliveries`: nullable `incident_json`, legacy null exclusion from delivered-incident queries.
- Document `listDeliveredNotificationIncidents` args (`sinceCursor` xor `sinceMs`, optional `kinds`), stable order, and returned sink-shaped JSON objects.
- Document cursor wire form `deliveredAt:incidentId:transition` and the exported encode/decode helpers.

## Acceptance criteria

- [x] `v2/docs/state-store.md` documents `operator_notification_deliveries` `incident_json`, legacy null exclusion, `listDeliveredNotificationIncidents`, and cursor wire form consistent with subspecs 00–01.

## Documentation updates

- `v2/docs/state-store.md` — `operator_notification_deliveries` schema (`incident_json` column, legacy null exclusion), delivered-incident query, and cursor wire form.
