# Document daemon-host pull contract

## Problem

`v2/docs/daemon-host.md` § Operator notifications documents sink discharge only. Pull consumers need the durable ledger contract: persisted incident JSON, cursor semantics, and shared wire form for sink discharge and catch-up reads.

## Decision ledger

- `daemon-host.md` § Operator notifications owns the cross-surface pull contract (persisted JSON, cursor wire form, legacy null exclusion) at operator/daemon altitude; rules out duplicating the full store API surface in `operator-runbook.md`.
- Document that sink discharge and future daemon `notification_list` / `notification_wait` RPCs read the same ledger rows and cursor wire form defined in `state-store.md`; rules out per-RPC cursor encodings.

## Prerequisites

- Subspecs 00–01: store persistence and query behavior are landed.
- Subspec 02: `state-store.md` documents the store-side contract this section cross-links.

## Task checklist

- Extend `v2/docs/daemon-host.md` § Operator notifications with delivery-ledger pull contract: new deliveries persist sink stdin JSON in `incident_json`, legacy key-only rows are excluded from pull queries, cursor wire form `deliveredAt:incidentId:transition`, and that sink discharge and pull consumers share that ledger and cursor semantics.
- Cross-link `state-store.md` for `listDeliveredNotificationIncidents` and cursor helper details.

## Acceptance criteria

- [ ] `v2/docs/daemon-host.md` § Operator notifications documents the delivery-ledger pull contract (persisted incident JSON, cursor semantics, legacy null exclusion, shared by sink discharge and pull consumers) consistent with subspecs 00–02.

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: delivery-ledger pull contract (persisted incident JSON, cursor semantics, shared by sink discharge and pull consumers).
