---
name: outcome-sheets-schema-and-standard
---

# Define two outcome sheets joining 1:1 to the cost CSVs

## Behavior

Add a small amount of outcome/context data alongside the cost CSVs so cost can be
joined to useful work — minimal additive context, not an analytics layer. Mirror the
existing cost-CSV split with two parallel outcome sheets that join 1:1:

- **Session-outcome sheet** — one row per Jarvis spec/run, joining to
  `session-costs.csv` on the spec identifier (work units, success status, session
  type, duration, files touched, …).
- **Overlord-outcome sheet** — one row per overlord session, joining to
  `overlord-costs.csv` (specs driven, overall success, session_type = orchestration,
  total duration, aggregate files touched).

Share column vocabulary across the two where it makes sense so the sheets stay
aggregatable, the same way the two cost CSVs share fields. Suggested session shape
(plan refines): `session_id, report_date, completed_work_units, success_status,
failure_reason, session_type, agent_count, duration_minutes, files_touched, notes`.

Per the audit classification, harness-known fields (`agent_count`, `duration_minutes`,
exit-derived status hints) are populated automatically/by derivation; judgment fields
(`completed_work_units`, `success_status`, `notes`) are recorded once by the observer,
not inferred per run. Reconcile with and extend the cost-reporting standard so the
schemas stay aggregatable and joinable. Unrecoverable judgment fields get a best-effort
value or a blank with a note — don't fabricate.

## Out of scope

- Backfilling existing cost-CSV rows.
- A querying/dashboard layer.

## Prerequisites

- An audit classifies each proposed outcome column as already-logged, derivable, or not-captured.
- The cost-reporting standard documents the `session-costs.csv` and `overlord-costs.csv` schemas.
