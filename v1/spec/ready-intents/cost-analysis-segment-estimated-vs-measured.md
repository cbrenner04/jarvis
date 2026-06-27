---
name: cost-analysis-segment-estimated-vs-measured
---

# Cost analysis segments estimated vs measured usage

Historical cost analysis can exclude or treat separately cursor (and other)
rows where `usage_source` is `estimated`, without hand-editing report CSVs.

Telemetry consumers, run-summary aggregations, and the operator cost-reporting
workflow expose `usage_source` (or an equivalent filter) so estimated cursor
spend does not blend with measured codex/claude spend in comparisons or totals
the operator intends as "real."

Document the segmentation rule in `v1/docs/operator-runbook.md` (cost-reporting
standard) and cursor provenance in `v2/docs/v1-behaviors.md`.

## Decisions

- Segment on `usage_source` (`estimated` vs `agent`/`computed`), not `cost_source` alone — rules out using dollar-source labels without usage provenance.
- Segmentation is opt-in filtering for analysis; telemetry still records all rows — rules out silently dropping estimated rows from `runs.jsonl`.

## Out of scope

- Imputed-notional cost computation.
- Cursor measurement spike or adapter changes.

## Prerequisites
