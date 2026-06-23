# Add outcome-sheet schemas and reporting rules

## Problem

Cost rows quantify spend but not delivered work. Define the two additive outcome
CSVs and their observer population rules without changing harness telemetry or
backfilling historical rows.

## Decisions

- Store outcomes in `reports/session-outcomes.csv` and `reports/overlord-outcomes.csv`, not as added cost-CSV columns; separate row shapes mirror the existing cost split.
- `session-outcomes.csv` columns are `session_id, report_date, completed_work_units, success_status, failure_reason, session_type, agent_count, duration_minutes, files_touched, notes`, not a future analytics schema; this is the minimum audited session context.
- `overlord-outcomes.csv` columns are `session_id, report_date, specs_driven, overall_success, failure_reason, session_type, total_duration, aggregate_files_touched, notes`, not duplicated per-spec rows; this preserves the audited roll-up vocabulary.
- `session_outcomes.session_id` equals `session-costs.name`, not a generated run ID; the existing spec identifier is the session-cost join key.
- `overlord_outcomes.session_id` equals `overlord-costs.session`, not `report`; `session` identifies the one overlord row when reports are combined.
- Both sheets use `report_date`, `session_type`, `failure_reason`, and `notes`, not sheet-specific aliases; shared names keep unions aggregatable.
- Session-only fields are `completed_work_units`, `success_status`, and `agent_count`; replacing them with cost proxies would erase observer judgment or per-run participation.
- Overlord-only fields are `specs_driven` and `overall_success`; copying per-spec fields would misrepresent the aggregate row.
- `session_type` is `orchestration` for every overlord row, not observer-selected; the sheet's subject fixes the classification.
- Harness-known values are derived once from the audit's sources and judgment values are observer-recorded once, not re-inferred per report; repeated inference would drift historical records.
- A missing judgment value is blank with an explanatory `notes` value, not a fabricated default; unknown and failed are distinct states.
- Backfill is excluded; changing existing cost-row coverage belongs to the separately prepared backfill work.
- Deferred to first consumer: controlled value sets for statuses, failure reasons, and non-overlord session types — pin when a caller needs it.
- Deferred to first consumer: CSV representation of `files_touched` beyond its count — pin when a caller needs it.

## Task checklist

- [ ] Create header-only `reports/session-outcomes.csv` and
  `reports/overlord-outcomes.csv` using the decided schemas.
- [ ] Extend `v1/docs/operator-runbook.md` § Cost reporting standard with both
  outcome-sheet schemas, exact joins to their cost sheets, row cardinality, and
  population rules.
- [ ] Cite `v2/docs/outcome-data-source-audit.md` as the source of automatic and
  derived fields; document its CSV and git-diff fallbacks without inventing new
  telemetry.
- [ ] Update `v2/docs/v1-behaviors.md` with the observer-visible outcome-reporting
  behavior and its durable sources.

## Acceptance criteria

- [ ] `reports/session-outcomes.csv` has one header-only schema for rows that join
  1:1 to `reports/session-costs.csv` through the existing spec identifier; it has
  no historical rows.
- [ ] `reports/overlord-outcomes.csv` has one header-only schema for rows that join
  1:1 to `reports/overlord-costs.csv` through the existing overlord session; it has
  no historical rows.
- [ ] The cost reporting standard makes both outcome schemas, common vocabulary,
  join keys, and one-row-per-cost-row rule observable to the operator.
- [ ] The operator-facing population rules distinguish audit-derived fields from
  observer judgment, preserve blanks for unrecoverable judgment, and do not require
  a telemetry change or a dashboard.
- [ ] `v2/docs/v1-behaviors.md` records the new outcome-reporting behavior with
  source citations.

## Documentation updates

- Update `v1/docs/operator-runbook.md` as the durable operator/workflow contract.
- Update `v2/docs/v1-behaviors.md` because this extends an existing operator-facing
  reporting behavior.
- Keep `v2/docs/outcome-data-source-audit.md` as the durable classification record;
  cross-link rather than duplicate its derivations.
