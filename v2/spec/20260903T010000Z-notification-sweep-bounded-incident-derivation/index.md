# Bounded operator-incident derivation and non-overlapping notification sweeps

- [x] [00 - Bounded incident candidate derivation](./00-bounded-incident-candidate-derivation.md)
- [x] [01 - Batched stage-attributed resolution](./01-batched-stage-attributed-resolution.md)
- [ ] [02 - Delivery-ledger derivation skip](./02-delivery-ledger-derivation-skip.md)
- [ ] [03 - Non-overlapping notification sweep timer](./03-non-overlapping-notification-sweep-timer.md)
- [ ] [04 - Document bounded notification sweep](./04-document-bounded-notification-sweep.md)

Land **00 → 01 → 02 → 03 → 04** when batched: `01`–`02` depend on bounded candidate queries from `00`; docs align with landed behavior. Operator-facing harness gates (`typecheck`, `test:v2`) land with subspec `04`.
