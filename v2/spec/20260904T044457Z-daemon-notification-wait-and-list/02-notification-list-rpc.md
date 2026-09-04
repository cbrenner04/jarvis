# Notification list RPC

## Problem

Pull consumers need a non-blocking daemon RPC to read delivered incidents from the ledger without entering the long-poll wait path.

## Decision ledger

- Add `notification_list` daemon RPC that reads `listDeliveredNotificationIncidents` from the delivery ledger, not `deriveOperatorIncidents`; rules out CLI polling live derivation or store scans on a timer.
- `notification_list` returns all matching ledger rows in stable store order without blocking, each as `{ incident, deliveryCursor }`; rules out mixing list with the wait long-poll path.
- Kind filtering is enforced at the RPC layer so non-matching deliveries do not appear in list results; rules out returning filtered incidents the caller must discard.
- `since` params accept exactly one lower bound: `sinceCursor` (store colon-delimited `deliveredAt:incidentId:transition` wire form) or `sinceMs`; rules out per-RPC cursor encodings or combining both bounds.
- Empty `kinds` array is rejected `invalid_params` before ledger query; rules out silent empty results via store `AND 0` filter.
- Deferred to first consumer: `notification_list` follow/stream mode — pin when `jarvis notifications list --follow` lands.

## Prerequisites

- Subspec 00: sweep persists `incident_json` on delivery so list results match sweep-recorded rows.

## Task checklist

- Implement `notification_list` RPC: validate params (including empty `kinds` → `invalid_params`), delegate to `listDeliveredNotificationIncidents`, return ordered `{ incident, deliveryCursor }` entries.
- Register `notification_list` on the daemon IPC handler map.
- Add `daemon-notification-wait.test.ts` regression `notification_list returns seeded ledger rows without blocking`: seed delivered incidents, assert list returns them for a since bound in store order and resolves promptly; fails against the pre-fix absent list RPC.
- Add `daemon-notification-wait.test.ts` regression `notification_list kind filter excludes non-matching deliveries`: seed mixed-kind deliveries, assert list with a kind set returns only matching incidents; fails against the pre-fix unfiltered list RPC.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-notification-wait.test.ts` test `notification_list returns seeded ledger rows without blocking` seeds delivered incidents and asserts list returns them for a since bound in store order without blocking; it fails against the pre-fix absent list RPC.
- [x] `v2/src/daemon/daemon-notification-wait.test.ts` test `notification_list kind filter excludes non-matching deliveries` seeds mixed-kind deliveries and asserts list with a kind set returns only matching incidents; it fails against the pre-fix unfiltered list RPC.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 03.
