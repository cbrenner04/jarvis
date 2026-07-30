# List rows report honest step state, attempt counts, and finish times

Implement subspecs in order: **00** then **01**. Subspec **01** depends on store terminal
reconciliation (`v2/spec/20260730T071755Z-store-timestamps-terminal-reconciliation`) recording
`reconciledAt` on killed/interrupted runs before this tree lands.

- [x] [00 - Workflow step snapshot projection](./00-workflow-step-snapshot-projection.md)
- [x] [01 - List row finish time](./01-list-row-finished-at-ms.md)
