---
name: daemon-notification-wait-and-list
---

# Daemon blocks on and lists delivered operator incidents from the ledger

## Prerequisites

- Delivery ledger rows persist the serialized incident JSON written to the sink at record time.
- The state store exposes an ordered delivered-incident query filterable by since cursor or timestamp and optional incident kinds.

## Module-boundary surface

- Daemon

## Problem

Even with a durable ledger, nothing wakes a sleeping operator: there is no daemon RPC to block until the next owed incident, and the notification sweep does not signal blocked waiters when it records a delivery.

## Decision ledger

- Add `notification_wait` and `notification_list` daemon RPCs that read the delivery ledger, not live derivation; rules out CLI polling `deriveOperatorIncidents` or store scans on a timer.
- `notification_wait` blocks until the next delivered row matching filters is owed to the caller's cursor, then returns one incident JSON object; rules out returning before the sweep records delivery.
- `notification_list` returns matching ledger rows without blocking; rules out mixing list with the wait long-poll path.
- The sweep wakes registered `notification_wait` callers when a new delivery lands; rules out sub-second client-side poll loops against the store.
- Kind filtering is enforced at the RPC layer on both wait and list so non-matching deliveries do not satisfy a wait or appear in list results; rules out returning filtered incidents the caller must discard.
- `since` cursor params use the store's colon-delimited `deliveredAt:incidentId:transition` wire form; rules out per-RPC cursor encodings.
- Deferred to first consumer: `notification_list` follow/stream mode — pin when `jarvis notifications list --follow` lands.

## Acceptance criteria

- [ ] The new `daemon-notification-wait.test.ts` test `notification_wait blocks until sweep records the next delivery` arms wait after a cursor, drives a sweep that records a new delivery, and asserts the RPC returns the incident JSON; it fails against the pre-fix absent RPC.
- [ ] The new `daemon-notification-wait.test.ts` test `notification_wait returns delivery recorded while no waiter was armed` records a delivery before wait begins then asserts the next wait with a prior cursor returns it immediately; it fails against the pre-fix path that cannot catch up from the ledger.
- [ ] The new `daemon-notification-wait.test.ts` test `notification_wait kind filter ignores non-matching deliveries` arms wait with a kind set, records a non-matching delivery, then a matching one, and asserts only the matching delivery satisfies the wait; it fails against the pre-fix unfiltered wait.
- [ ] The new `daemon-notification-wait.test.ts` test `notification_list returns ledger rows without blocking` seeds delivered incidents and asserts list returns them for a since bound without entering the wait path; it fails against the pre-fix absent list RPC.
- [ ] The new `daemon-notification-wait.test.ts` test `notification_list kind filter excludes non-matching deliveries` seeds mixed-kind deliveries and asserts list with a kind set returns only matching incidents; it fails against the pre-fix unfiltered list RPC.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: `notification_wait` / `notification_list` RPC contracts, waiter wake on sweep delivery, and kind/since filter parameters.
