# Add outcome-sheet schemas and reporting rules

## Problem

Cost rows quantify spend but not delivered work. Define two additive outcome CSVs
and an observer reconciliation workflow without telemetry changes or backfill.

## Decisions

- Identify a session cost row by `(report, name)`, not `name` alone; `name` has no global uniqueness guarantee.
- Identify an overlord cost row by `(report, session)`, not `session` alone; `session` has no global uniqueness guarantee.
- Require each cost-sheet composite identity to be unique before an outcome row is written, not silently select a duplicate; a 1:1 join must be verifiable.
- Store session outcomes in `reports/session-outcomes.csv` with `report, session_id, report_date, completed_work_units, success_status, failure_reason, session_type, agent_count, duration_minutes, files_touched, notes`, not added cost columns; the split mirrors cost rows.
- Store overlord outcomes in `reports/overlord-outcomes.csv` with `report, session_id, report_date, specs_driven, overall_success, failure_reason, session_type, duration_minutes, files_touched, notes`, not per-spec duplicates; one row represents one overlord cost row.
- Join `session-outcomes.(report, session_id)` to `session-costs.(report, name)`, not a generated run ID; the outcome key is the stable cost-row identity.
- Join `overlord-outcomes.(report, session_id)` to `overlord-costs.(report, session)`, not `session_id` alone; the outcome key is the stable cost-row identity.
- Use `report_date`, `session_type`, `failure_reason`, `duration_minutes`, `files_touched`, and `notes` on both sheets, not aggregate-specific aliases; same units and semantics permit unions.
- Define both duration columns as total plan-plus-run execution time in decimal minutes, rounded to two decimal places, not `overlord-costs.api_time`; API runtime is a different measure.
- Define both file columns as a non-negative count of distinct changed paths, not a CSV list; an overlord row counts the distinct-path union for its whole session.
- Set overlord `session_type` to `orchestration`, not observer-selected; the row subject fixes it.
- Run the observer’s **outcome reconciliation** after final cost-row reconciliation and before closing the session report, not as an append-only later record; it writes or amends exactly one outcome row for each unique cost-row identity.
- On a rerun or correction, amend the matching outcome row after rechecking its cost identity, not append another row; duplicate matching outcome rows are reconciled to one row or left unresolved with a note until attribution is certain.
- Derive only from the audit’s primary source first, not from a plausible but unbound artifact; a fallback is allowed only when it is attributable to the exact composite identity, otherwise leave the field blank and state the missing attribution in `notes`.
- Derive patch `report_date` from its JSONL run start and duration from the matching cost row’s `plan_time + run_time`; use an identity-bound CSV date or JSONL timestamp-span fallback only when the primary source is absent, otherwise blank with a note.
- Derive overlord `report_date` from the earliest matched session outcome date, not the cost sheet’s unconstrained `report` label; blank it with a note when no matched dated session exists.
- Derive patch `agent_count` from filtered JSONL distinct agents and `session_type` from JSONL mode, not invocation count or an assumed mode; plan-involved report dates, counts, and session types are observer-provided from a contemporaneous record or blank with a note because plan phases lack equivalent telemetry.
- Derive `files_touched` from the identity-bound run-base git diff and overlord files from the session-base distinct-path union, not `HEAD~1`; a weaker git fallback is allowed only when every included commit is uniquely attributable to the same cost identity, otherwise blank with a note.
- Copy `specs_driven` from the matching overlord cost row’s `session_count`, and derive overlord duration from its uniquely matched session-cost rows; do not substitute `api_time` or a JSONL span when complete attribution is unavailable.
- Treat `completed_work_units` as the observer count of completed scoped deliverables: completed rows count all delivered units, partial rows count only delivered units, blocked/canceled/failed rows count units completed before the terminal state, and plan-only rows count one only for a finalized plan/spec; unknown is blank with a note.
- Normalize `success_status` and `overall_success` to the same observer-judged completed, partial, blocked, canceled, failed, or unknown semantics, not raw exit hints; unknown is blank with a note.
- Use exit-derived status and failure hints only as input to observer judgment, not as an override of it; if judgment differs from the hint, record the basis in `notes`.
- Leave unrecoverable judgment or derived values blank with an explanatory `notes` value, not a fabricated zero, success, or failure; blank and failure are distinct.
- Exclude backfill, dashboards, and telemetry changes, not current-session reconciliation; historical cost rows remain untouched.
- Deferred to first consumer: controlled CSV spellings for the defined outcome semantics — pin when a caller needs them.

## Task checklist

- [ ] Create header-only outcome CSVs using the decided schemas.
- [ ] Extend `v1/docs/operator-runbook.md` § Cost reporting standard with composite cost-row identities, outcome reconciliation timing/lifecycle, schemas, joins, and normalized aggregate semantics.
- [ ] Cite `v2/docs/outcome-data-source-audit.md` for every automatic derivation; document the identity-bound CSV, JSONL, and git fallbacks plus source-or-blank handling without adding telemetry.
- [ ] Update `v2/docs/v1-behaviors.md` with the observer-visible outcome workflow and durable sources.

## Acceptance criteria

- [x] Each header-only outcome sheet exposes a composite identity that joins exactly one current cost row and permits no historical rows.
- [x] The cost reporting standard makes duplicate cost identities blocking, reconciles reruns by amendment, and leaves one outcome row per cost row after reconciliation.
- [x] The operator can perform outcome reconciliation at session close, distinguish observer judgment from exit-derived hints, and record completed, partial, blocked, canceled, failed, plan-only, and unknown outcomes without fabrication.
- [x] The operator-facing source-or-blank policy uses the audit’s primary sources, permits only identity-bound CSV/JSONL/git fallbacks, covers plan-involved `agent_count`, and records unreliable attribution as blank plus a note.
- [x] The cost reporting standard defines comparable duration and file-count measures, including overlord sum/union semantics, rather than substituting API runtime or duplicate file counts.
- [x] `v2/docs/v1-behaviors.md` records the outcome-reporting behavior with source citations.

## Documentation updates

- Update `v1/docs/operator-runbook.md` as the durable operator/workflow contract.
- Update `v2/docs/v1-behaviors.md` because this extends operator-facing reporting behavior.
- Keep `v2/docs/outcome-data-source-audit.md` as the durable classification record; cross-link rather than duplicate its derivations.
