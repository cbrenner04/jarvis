# Delivery ledger records delivered incident payloads for pull consumers

- [ ] [00 - Delivery ledger persists incident JSON](./00-delivery-ledger-persists-incident-json.md)
- [x] [01 - Delivered-incident query API](./01-delivered-incident-query-api.md)
- [x] [02 - Document state-store delivered incidents](./02-document-state-store-delivered-incidents.md)
- [x] [03 - Document daemon-host pull contract](./03-document-daemon-host-pull-contract.md)

Land **00 → 01 → 02 → 03**: persistence schema and query API first; docs align with landed store behavior. Daemon RPC and CLI pull consumers are separate ready-intents that depend on this store contract.
