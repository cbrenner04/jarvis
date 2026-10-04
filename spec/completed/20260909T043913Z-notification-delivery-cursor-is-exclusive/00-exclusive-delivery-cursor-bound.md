# 00 - Exclusive delivery-cursor bound

## Problem

The `sinceCursor` branch of `listDeliveredNotificationIncidents` (`state-store.ts`) uses `>=` on the `(delivered_at, incident_id, transition)` tuple. `notification_wait` and `notification_list` both read through it, so the cursor's own incident is the first row of every chained call. The CLI's `--project` catch-up (`scanForProject` in `commands/notifications.ts`) even compensates by searching for the cursor's row and slicing past it — evidence the inclusive bound was never the intended contract. `state-store.test.ts` pins the inclusive bound by name (`@mutate ") >= (?, ?, ?)" -> ") > (?, ?, ?)"`).

## Decisions

- The `sinceCursor` bound is exclusive: the tuple comparison becomes `>`; the incident that produced the cursor is never returned by `wait` or `list` for that cursor; rules out the inclusive comparison that makes chaining a fixed point.
- `sinceMs` (duration and timestamp `--since` forms) keeps `>=`, inclusive of the window edge, because it names a time, not an already-delivered incident; rules out changing all three forms together.
- `wait` with a cursor equal to the newest owed incident registers a waiter and blocks for the next delivery rather than returning immediately; rules out a fast-return that reads as "nothing is happening".
- `scanForProject` no longer searches for the cursor's row: with an exclusive list every entry is after the cursor, so it scans from the first entry; rules out keeping compensation code for a bound that no longer exists.
- The existing store pin flips: the cursor test expects the cursor's incident excluded and its mutation directive targets `>` → `>=`.

## Tasks

- Flip the comparison in `listDeliveredNotificationIncidents` and simplify `scanForProject`.
- Retarget the existing store and daemon tests that assumed inclusion; add the three tests below.
- Update `daemon-host.md` and the runbook chaining example.

## Acceptance criteria

- [x] `daemon-notification-wait.test.ts` test `notification_wait with an incident's own cursor blocks for the next delivery` proves `since` set to an incident's own delivery cursor does not return that incident and instead resolves with the next one once the sweep records it; it fails against the current inclusive bound.
- [x] `daemon-notification-wait.test.ts` test `chained waits over three owed incidents return the second and third without repeating` proves two waits chained on each returned `deliveryCursor` yield the second and third incidents.
- [x] `daemon-notification-wait.test.ts` test `notification_list with a delivery cursor excludes the incident at that cursor while sinceMs stays inclusive` proves the cursor form excludes and the `sinceMs` form still includes an incident delivered exactly at the bound.
- [x] `state-store.test.ts` delivered-ledger cursor test expects the cursor's own incident excluded and its `@mutate` directive is `") > (?, ?, ?)" -> ") >= (?, ?, ?)"`.
- [x] `commands/notifications.test.ts` `--project` catch-up cases stay green through the `scanForProject` simplification.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `notification_wait` / `notification_list` return deliveries strictly after a delivery cursor; `sinceMs` stays inclusive.
- `v2/docs/operator-runbook.md` — chaining example: feed `deliveryCursor` back as `--since` and the loop advances.
- `v2/docs/v1-behaviors.md` — record the exclusive cursor bound.
