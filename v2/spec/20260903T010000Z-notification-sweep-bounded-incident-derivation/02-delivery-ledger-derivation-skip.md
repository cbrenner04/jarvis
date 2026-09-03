# Delivery-ledger derivation skip

## Problem

The sweep always runs full `deriveOperatorIncidents` before `hasNotificationDelivery` short-circuits delivery, so already-recorded `(incidentId, transition)` pairs still pay full derivation cost on every five-second tick.

## Decision ledger

- Delivery-ledger rows suppress incident re-derivation, not only re-delivery: incidents with an existing `operator_notification_deliveries` row for their `(incidentId, transition)` are excluded before expensive pipeline/run derivation work; rules out derive-then-ledger-diff on every tick.
- Ledger consult happens once per sweep against the bounded candidate set, not per-stage inside nested loops; rules out per-row `hasNotificationDelivery` inside hot derivation paths without a sweep-level filter plan.
- Suppression applies to derivation output only; ledger insert semantics and concurrent multi-daemon races stay unchanged; rules out altering `tryRecordNotificationDelivery` discharge behavior.

## Prerequisites

- Subspec 00: bounded candidate queries feed derivation.

## Task checklist

- Skip deriving incidents whose `(incidentId, transition)` already exists in the delivery ledger before running pipeline/run incident collectors on rows that cannot change the owed set.
- Add `operator-notification.test.ts` regression `delivery ledger suppresses incident re-derivation on later sweeps`: record a delivery-ledger row, instrument derivation (spy or counter on `deriveOperatorIncidents` internals), run a later sweep, and assert the ledgered incident is not re-derived; fails against the pre-fix derive-then-ledger-diff path.

## Acceptance criteria

- [ ] `v2/src/daemon/operator-notification.test.ts` test `delivery ledger suppresses incident re-derivation on later sweeps` records a delivery-ledger row then asserts a later sweep does not re-derive that incident; it fails against the pre-fix derive-then-ledger-diff path.
- [ ] `v2/src/daemon/operator-notification.test.ts` — `concurrent sweeps deliver an owed incident once` stays green (ledger discharge semantics unchanged).
- [ ] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 04.
