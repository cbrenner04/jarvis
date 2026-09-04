# Notification wait RPC

## Problem

Even with a durable delivery ledger and store query API, nothing wakes a sleeping operator: there is no daemon RPC to block until the next owed incident, and the notification sweep does not signal blocked waiters when it records a delivery.

## Decision ledger

- Add `notification_wait` daemon RPC that reads `listDeliveredNotificationIncidents` from the delivery ledger, not `deriveOperatorIncidents`; rules out CLI polling live derivation or store scans on a timer.
- `notification_wait` blocks until the next delivered row matching filters is owed to the caller's cursor, then returns one sink-shaped incident object plus `deliveryCursor` (`encodeNotificationDeliveryCursor` for that row); rules out sink JSON alone with no cursor for `--since` chaining.
- When a matching row already exists at or after the caller's `sinceCursor` / `sinceMs` bound, `notification_wait` returns it immediately without registering a waiter; rules out requiring a fresh sweep tick for catch-up.
- The sweep wakes registered `notification_wait` callers on a winning ledger insert with non-null `incident_json` and when the sweep observes an already-delivered row matching their filters (loser daemon path); rules out wake-only-on-winning-insert deadlock across keyed daemons.
- Kind filtering is enforced at the RPC layer so non-matching deliveries do not satisfy a wait; rules out returning filtered incidents the caller must discard.
- `since` params accept exactly one lower bound: `sinceCursor` (store colon-delimited `deliveredAt:incidentId:transition` wire form) or `sinceMs`; rules out per-RPC cursor encodings or combining both bounds.
- Empty `kinds` array is rejected `invalid_params` before waiter registration or ledger query; rules out indefinite block via store `AND 0` filter.
- Waiter registration is in-process on the daemon host; aborted client signals drop the waiter without resolving; rules out leaking waiters across disconnect.
- `notification_wait` stays available on a retiring (superseded) daemon with no `daemon_superseded` guard, matching `run wait`; rules out tearing down armed waiters or rejecting new waits on supersession.
- Deferred to first consumer: `notification_wait` timeout param — pin when `jarvis notifications wait` admission needs a bounded block.

## Prerequisites

- Subspec 00: sweep persists `incident_json` on delivery so wait results match sweep-recorded rows.

## Task checklist

- Add in-process waiter registry keyed by filter (`sinceCursor` or `sinceMs`, optional `kinds`).
- Implement `notification_wait` RPC: validate params (including empty `kinds` → `invalid_params`), return `{ incident, deliveryCursor }` immediately when the ledger already has the next matching row, else register a waiter and resolve on sweep delivery or abort.
- Hook waiter wake into the notification sweep after a winning delivery insert with non-null `incident_json` and when `hasNotificationDelivery` skips spawn for a row matching armed filters.
- Register `notification_wait` on the daemon IPC handler map.
- Add `daemon-notification-wait.test.ts` regression `notification_wait blocks until sweep records the next delivery`: arm wait after a cursor, drive a sweep that records a new delivery, assert the RPC returns the incident JSON and `deliveryCursor`; fails against the pre-fix absent RPC.
- Add `daemon-notification-wait.test.ts` regression `notification_wait returns delivery recorded while no waiter was armed`: record a delivery before wait begins, assert the next wait with a prior cursor returns it immediately; fails against the pre-fix path that cannot catch up from the ledger.
- Add `daemon-notification-wait.test.ts` regression `notification_wait kind filter ignores non-matching deliveries`: arm wait with a kind set, record a non-matching delivery then a matching one, assert only the matching delivery satisfies the wait; fails against the pre-fix unfiltered wait.
- Add `daemon-notification-wait.test.ts` regression `notification_wait abort drops armed waiter without late resolve`: arm wait, abort the client `AbortSignal`, drive a later matching delivery, assert the aborted wait rejects and no waiter resolves; fails against the pre-fix absent abort cleanup (mirrors `daemon-wait-run-completion.test.ts` disconnect semantics).
- Add `daemon-notification-wait.test.ts` regression `notification_wait wakes when another daemon records the delivery`: arm wait on daemon A, record a matching delivery through daemon B's sweep, assert daemon A's wait resolves; fails against the pre-fix wake-only-on-winning-insert path.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-notification-wait.test.ts` test `notification_wait blocks until sweep records the next delivery` arms wait after a cursor, drives a sweep that records a new delivery, and asserts the RPC returns the incident JSON and `deliveryCursor`; it fails against the pre-fix absent RPC.
- [x] `v2/src/daemon/daemon-notification-wait.test.ts` test `notification_wait returns delivery recorded while no waiter was armed` records a delivery before wait begins then asserts the next wait with a prior cursor returns it immediately; it fails against the pre-fix path that cannot catch up from the ledger.
- [x] `v2/src/daemon/daemon-notification-wait.test.ts` test `notification_wait kind filter ignores non-matching deliveries` arms wait with a kind set, records a non-matching delivery, then a matching one, and asserts only the matching delivery satisfies the wait; it fails against the pre-fix unfiltered wait.
- [x] `v2/src/daemon/daemon-notification-wait.test.ts` test `notification_wait abort drops armed waiter without late resolve` arms wait, aborts the client signal, records a later matching delivery, and asserts the aborted wait rejects with no late resolve; it fails against the pre-fix absent abort cleanup.
- [x] `v2/src/daemon/daemon-notification-wait.test.ts` test `notification_wait wakes when another daemon records the delivery` arms wait on one daemon, records a matching delivery on another, and asserts the first daemon's wait resolves; it fails against the pre-fix wake-only-on-winning-insert path.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 03.
