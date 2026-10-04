# Document notification wait and list RPCs

## Problem

`v2/docs/daemon-host.md` § Operator notifications documents the delivery-ledger pull contract and names future `notification_wait` / `notification_list` RPCs without their wire contracts, waiter wake semantics, or filter parameters.

## Decision ledger

- `daemon-host.md` § Operator notifications is the durable home for daemon RPC contracts; rules out duplicating full RPC param lists in `operator-runbook.md` or `state-store.md`.
- Replace "future daemon `notification_list` / `notification_wait` RPCs" with landed RPC contracts cross-linking `state-store.md` for cursor encode/decode and query ordering; rules out leaving aspirational wording after implementation.
- Document sweep waiter wake (winning insert and already-delivered observation) as the mechanism that resolves blocked `notification_wait` calls; rules out implying clients must poll the store between sweep ticks.
- Document `deliveryCursor` on wait/list responses for `--since` chaining; rules out sink JSON alone as the cursor source.
- Document `notification_wait` availability on retiring daemons (no `daemon_superseded` guard), matching `run wait`; rules out documenting supersession rejection for notification wait.

## Prerequisites

- Subspecs 00–02: sweep payload persistence, `notification_wait`, and `notification_list` RPCs are landed and tested.

## Task checklist

- Extend `v2/docs/daemon-host.md` § Operator notifications with `notification_wait` / `notification_list` RPC contracts: params (`sinceCursor` or `sinceMs`, optional non-empty `kinds`), response shapes (`{ incident, deliveryCursor }` vs ordered list), ledger-only reads, kind filtering at the RPC layer, empty-`kinds` `invalid_params`, waiter wake on sweep delivery (winning insert and already-delivered observation), and retiring-daemon availability for `notification_wait`.
- Cross-link `state-store.md` for cursor wire form and `listDeliveredNotificationIncidents` ordering.

## Acceptance criteria

- [x] `v2/docs/daemon-host.md` § Operator notifications documents `notification_wait` / `notification_list` RPC contracts, `deliveryCursor` responses, waiter wake on sweep delivery, kind/since filter parameters, empty-`kinds` rejection, and retiring-daemon `notification_wait` availability consistent with subspecs 00–02.

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: `notification_wait` / `notification_list` RPC contracts, `deliveryCursor` responses, waiter wake on sweep delivery, kind/since filter parameters, empty-`kinds` rejection, and retiring-daemon availability.
