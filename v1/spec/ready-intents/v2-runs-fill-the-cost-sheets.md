---
name: v2-runs-fill-the-cost-sheets
---

# Session cost sheets can be filled for v2 runs

`reports/session-costs.csv` is filled from `runs.jsonl` (v1). v2 writes only `telemetry.jsonl`, so a v2-driven session reports no cost even once invocations carry `cost_usd`. As dogfooding shifts to v2, the cost sheets go dark.

## Decisions

- Cost tooling reads `telemetry.jsonl` for v2 rows (added, not replacing `runs.jsonl` for v1); v2 does not gain a second write path shaped like `runs.jsonl`. One schema to parse, no dual-write to keep in sync.
- Cost must join on the same identity the sheets already use (`namespace` / `run_id`), so a mixed v1+v2 session totals correctly.
- Only real invocations count; test-fixture rows must not inflate totals (see `tests-write-telemetry-to-the-operator-home`).

## Observable behavior

An operator running a v2-only session can produce a per-session cost figure from the documented file, matching the sum of that session's invocation `cost_usd`.

## Documentation updates

- `v1/docs/operator-runbook.md` § Cost reporting standard — name the v2 cost source and the command.

## Prerequisites

- v2 invocations record a non-null `cost_usd` with `cost_source: agent`.
