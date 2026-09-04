# Daemon blocks on and lists delivered operator incidents from the ledger

- [ ] [00 - Sweep incident JSON persistence](./00-sweep-incident-json-persistence.md)
- [ ] [01 - Notification wait RPC](./01-notification-wait-rpc.md)
- [ ] [02 - Notification list RPC](./02-notification-list-rpc.md)
- [ ] [03 - Document notification wait and list RPCs](./03-document-notification-wait-list-rpcs.md)

Land **00 → 01 → 02 → 03**: sweep payload persistence first; wait RPC and waiter wake; list RPC reads the same ledger; docs align with landed daemon behavior.
