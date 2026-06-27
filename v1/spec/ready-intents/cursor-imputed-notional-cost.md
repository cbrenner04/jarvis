---
name: cursor-imputed-notional-cost
---

# Imputed notional cost for estimated cursor comparison

Estimated cursor rows (especially subscription-included Composer 2.5) carry an
explicit imputed comparison cost: estimated tokens × reference rate from
`data/prices.json`, labeled `imputed` — for relative agent comparison only,
never summed into real spend totals or operator invoice figures.

Imputed pricing uses jarvis price-library rates only; ignore dollar amounts in
Cursor dashboard export CSVs (token columns may inform future reconciliation,
not imputation).

Surface imputed cost in run summary and/or telemetry fields operators use for
agent comparison, distinct from `cost_usd` when `cost_source` is `estimated`.
Update `v2/docs/v1-behaviors.md` and `v1/docs/operator-runbook.md`.

## Decisions

- Imputed rate from jarvis `prices.json`, not Cursor export price columns — rules out trusting dashboard dollar fields.
- Imputed values excluded from real-spend aggregates (`total_cost`, invoice-oriented totals) — rules out folding imputed into spend the operator treats as billed.
- Deferred to first consumer: which telemetry field carries imputed cost when both estimated `cost_usd` and imputed exist — pin when report consumers need a stable column name.

## Out of scope

- Dashboard CSV run correlation.
- Measured-usage adapter work.

## Prerequisites

- Every cursor run resolves to a price key
