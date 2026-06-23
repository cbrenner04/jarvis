# Record the outcome-data source audit

## Problem

Before any outcome sheet is designed, we must know which proposed outcome columns
the harness already records, which are derivable from existing logs, and which are
genuinely missing. Without this, the schema/backfill work risks adding harness
behavior we don't need. Produce a recorded classification that decides "log, or just
schema?" per column. No runtime change.

## What's already recorded (inputs to audit, do not re-derive)

- Telemetry JSONL — `~/.jarvis/runs.jsonl` *is* the telemetry JSONL (one file, not
  two), documented in `v1/docs/run-loop.md` § Run telemetry file / Token usage and
  cost tracking and `v1/docs/quota-signals.md` § Patch telemetry: per-invocation rows
  carrying `agent`, `configured_model`, `kind`, `exitReason`,
  `mode`/`plan_phase`/`patch_phase`, `namespace`, `ts`, `run_start_ts`, `usage`
  (token buckets), `usage_source`, `cost_usd`, `cost_source`, `record_role`. Patch
  mode only; plan phases emit limited rows — so plan/overlord-side derivations cannot
  assume full telemetry coverage.
- Cost CSV headers (`v1/docs/operator-runbook.md` § Cost reporting standard):
  `session-costs.csv` (carries `plan_time`/`run_time`) and `overlord-costs.csv`
  (carries `session_count`, `api_time`, `total_cost`, `avg_cost_per_spec`) columns.
- Per-session markdown reports under `reports/` and the run git diff.

The proposed outcome columns to classify, from
`v2/spec/ready-intents/outcome-sheets-schema-and-standard.md`:

- Session sheet: `session_id, report_date, completed_work_units, success_status,
  failure_reason, session_type, agent_count, duration_minutes, files_touched, notes`.
- Overlord sheet roll-ups (pinned identifiers): `specs_driven`, `overall_success`,
  `session_type` (= `orchestration`), `total_duration`, `aggregate_files_touched`.

## Decisions

- Audit home is a new `v2/docs/` design-decision record, not the operator-runbook cost standard. Downstream schema work extends operator-runbook separately; this is the cited load-bearing decision, not a runtime doc.
- Classification source of truth is the documented telemetry schema + cost-CSV headers in committed docs **plus the run git diff** (the diff is an admitted source for file-set derivations), not a live dump of the operator's machine-local `~/.jarvis/runs.jsonl` (not in repo, machine-specific). A live file may be cited as confirmation only. Rules out: excluding the run diff and forcing `files_touched` into not-captured. The audit must note whether the diff is reliably persisted post-run; if not, downgrade diff-sourced rows accordingly.
- Each proposed column gets one bucket — already-logged / derivable / not-captured — **except genuinely hybrid status fields, which may carry a compound classification (derived-hint + observer-override)**. Rules out: forcing `success_status` into observer-only, which contradicts its downstream schema (an `exitReason`/quota-derived hint the observer can override).
- Classification biases toward already-logged/derivable over not-captured: no column may be classified not-captured when a derivation from a documented telemetry field or cost-CSV header exists. Rules out: an audit that dumps columns into not-captured and still passes.
- Derivable rows name the source field(s) + derivation, and every named source field is traceable to its cited doc. `agent_count`, `duration_minutes`, and `files_touched` are *candidate* derivations the audit must verify against the docs, not asserted classifications inherited from the seed.
- Join/bookkeeping keys (`session_id`, `report_date`) are not outcomes: classify `session_id` as the cost-CSV join key and `report_date` as derivable from `ts`, rather than forcing an outcome bucket.
- Both session-sheet and overlord-sheet proposed columns are classified — not the session sheet alone.
- Genuinely-not-captured columns are recorded as scoped follow-ups in the audit, not implemented here; the audit makes no telemetry/CSV change.

## Task checklist

- [ ] Add `v2/docs/outcome-data-source-audit.md` with an inventory of the recorded
  telemetry + cost-CSV fields (citing the source docs above).
- [ ] Add a classification table: one row per proposed session-sheet and overlord-sheet
  column (session keys + outcomes, and `specs_driven`, `overall_success`, `session_type`,
  `total_duration`, `aggregate_files_touched`), each assigned already-logged / derivable /
  not-captured — or a compound derived-hint + observer-override for hybrid status.
- [ ] For each derivable row, name the existing log field(s) and the derivation, and
  trace each named field to its cited doc. Verify the candidate derivations rather than
  inherit them:
  - `agent_count` — distinct real agents in the fallback chain, excluding
    `record_role: "run_terminal"` duplicate-summary rows and synthetic `agent: harness`
    bookkeeping rows (a naive `runs.jsonl` row count is wrong).
  - `duration_minutes` — check `session-costs.csv` `plan_time`/`run_time` (already-logged)
    before claiming `runs.jsonl` derivation.
  - `files_touched` — from the run git diff; note diff persistence reliability.
- [ ] Classify `success_status` as compound: an `exitReason`/quota-signal derived hint
  plus an observer override, not observer-only.
- [ ] Classify overlord roll-ups against `overlord-costs.csv` (`session_count` =
  `specs_driven`, `api_time` = `total_duration`, etc. — most are already-logged), and
  flag `aggregate_files_touched`: no CSV home and hits the patch-only telemetry gap
  (plan/overlord sessions emit limited rows).
- [ ] Record each not-captured column as a scoped follow-up; note that judgment columns
  (`completed_work_units`, `notes`) are observer-recorded, not harness-derivable.
- [ ] State explicitly that the audit is a classification only and changes no telemetry
  or CSV behavior.

## Acceptance criteria

- [ ] `v2/docs/outcome-data-source-audit.md` exists and inventories the telemetry
  JSONL and cost-CSV fields the harness already records, citing `v1/docs/run-loop.md`,
  `v1/docs/quota-signals.md`, and `v1/docs/operator-runbook.md`.
- [ ] The doc classifies every proposed session-sheet column and every enumerated
  overlord roll-up column (`specs_driven`, `overall_success`, `session_type`,
  `total_duration`, `aggregate_files_touched`) into already-logged, derivable, or
  not-captured — `success_status` may instead carry a compound derived-hint +
  observer-override classification.
- [ ] No column is classified not-captured when a derivation from a documented
  telemetry field or cost-CSV header exists (the bias-toward-captured check bites on
  misclassification).
- [ ] Every column classified derivable names the source log field(s) and the
  derivation that produces it, and every named source field is traceable to its cited
  doc.
- [ ] The `agent_count` derivation states the filter excluding `record_role:
  "run_terminal"` and synthetic `agent: harness` rows; `duration_minutes` and
  `files_touched` are derived against the docs, not asserted from the seed.
- [ ] `session_id` is classified the cost-CSV join key and `report_date` derivable
  from `ts`; `aggregate_files_touched` is flagged as having no CSV home and hitting the
  patch-only telemetry gap.
- [ ] Every column classified not-captured is recorded as a scoped follow-up, and the
  judgment columns (`completed_work_units`, `notes`) are marked observer-recorded
  rather than harness-derivable.
- [ ] The doc states the audit makes no telemetry or CSV behavior change.

## Documentation updates

- New durable doc `v2/docs/outcome-data-source-audit.md` is itself the deliverable.
- No `v2/docs/v1-behaviors.md` update: net-new audit record, no existing v1 behavior
  changes.
