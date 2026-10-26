# Pipeline hand-finished lane recovery

- [x] [00 - Adopt a hand-published lane PR at chained implement](./00-adopt-hand-published-lane-pr.md)
- [x] [01 - Revive severed dependent lanes when the predecessor recovers](./01-revive-severed-dependent-lanes.md)

## Decisions

- Recovery entry point stays `jarvis pipeline resume <pipeline-id> <lane>`; no new verb.
- 00 before 01: 01's end-to-end test recovers the predecessor through 00's adoption.
