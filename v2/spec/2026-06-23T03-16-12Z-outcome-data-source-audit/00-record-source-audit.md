# Record the outcome-data source audit

## Problem

Before any outcome sheet is designed, we must know which proposed outcome columns
the harness already records, which are derivable from existing logs, and which are
genuinely missing. Without this, the schema/backfill work risks adding harness
behavior we don't need. Produce a recorded classification that decides "log, or just
schema?" per column. No runtime change.

## What's already recorded (inputs to audit, do not re-derive)

- Telemetry JSONL (`~/.jarvis/runs.jsonl`), documented in `v1/docs/run-loop.md`
  § Run telemetry file / Token usage and cost tracking and `v1/docs/quota-signals.md`
  § Patch telemetry: per-invocation rows carrying `agent`, `configured_model`,
  `kind`, `exitReason`, `mode`/`plan_phase`/`patch_phase`, `namespace`, `ts`,
  `run_start_ts`, `usage` (token buckets), `usage_source`, `cost_usd`, `cost_source`,
  `record_role`. Patch mode only; plan phases emit limited rows.
- Cost CSV headers (`v1/docs/operator-runbook.md` § Cost reporting standard):
  `session-costs.csv` and `overlord-costs.csv` columns.
- Per-session markdown reports under `reports/` and the run git diff.

The proposed outcome columns to classify are the session-sheet shape
(`session_id, report_date, completed_work_units, success_status, failure_reason,
session_type, agent_count, duration_minutes, files_touched, notes`) and the
overlord-sheet roll-ups (specs driven, overall success, `session_type =
orchestration`, total duration, aggregate files touched) from
`v2/spec/ready-intents/outcome-sheets-schema-and-standard.md`.

## Decisions

- Audit home is a new `v2/docs/` design-decision record, not the operator-runbook cost standard. Downstream schema work extends operator-runbook separately; this is the cited load-bearing decision, not a runtime doc.
- Classification source of truth is the documented telemetry schema + cost CSV headers in committed docs, not a live dump of the operator's machine-local `~/.jarvis/runs.jsonl` (not in repo, machine-specific). A live file may be cited as confirmation only.
- Every proposed column gets exactly one bucket: already-logged / derivable / not-captured. Derivable rows name the source field + derivation.
- Both session-sheet and overlord-sheet proposed columns are classified — not the session sheet alone.
- Genuinely-not-captured columns are recorded as scoped follow-ups in the audit, not implemented here; the audit makes no telemetry/CSV change.

## Task checklist

- [ ] Add `v2/docs/outcome-data-source-audit.md` with an inventory of the recorded
  telemetry + cost-CSV fields (citing the source docs above).
- [ ] Add a classification table: one row per proposed session-sheet and
  overlord-sheet column, each assigned exactly one of already-logged / derivable /
  not-captured.
- [ ] For each derivable row, name the existing log field(s) and the derivation
  (e.g. `agent_count`/`duration_minutes` from `runs.jsonl` rows, `files_touched`
  from the run diff).
- [ ] Record each not-captured column as a scoped follow-up; note that judgment
  columns (`completed_work_units`, `success_status`, `notes`) are observer-recorded,
  not harness-derivable.
- [ ] State explicitly that the audit is a classification only and changes no
  telemetry or CSV behavior.

## Acceptance criteria

- [ ] `v2/docs/outcome-data-source-audit.md` exists and inventories the telemetry
  JSONL and cost-CSV fields the harness already records, citing `v1/docs/run-loop.md`,
  `v1/docs/quota-signals.md`, and `v1/docs/operator-runbook.md`.
- [ ] The doc classifies every proposed session-sheet column and every overlord-sheet
  roll-up column into exactly one of: already-logged, derivable, or not-captured.
- [ ] Every column classified derivable names the source log field(s) and the
  derivation that produces it.
- [ ] Every column classified not-captured is recorded as a scoped follow-up, and the
  judgment columns (`completed_work_units`, `success_status`, `notes`) are marked
  observer-recorded rather than harness-derivable.
- [ ] The doc states the audit makes no telemetry or CSV behavior change.

## Documentation updates

- New durable doc `v2/docs/outcome-data-source-audit.md` is itself the deliverable.
- No `v2/docs/v1-behaviors.md` update: net-new audit record, no existing v1 behavior
  changes.
