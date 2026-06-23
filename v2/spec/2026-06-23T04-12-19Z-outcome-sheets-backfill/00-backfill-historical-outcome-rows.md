# Backfill historical outcome rows

## Problem

The outcome sheets have headers but no rows while the cost sheets already contain
historical sessions. Backfill both sheets from attributable historical evidence so
each existing cost row has one joining outcome row.

## Decisions

- Backfill every unique current cost-row identity, not only rows with JSONL coverage; unrecoverable fields stay blank with a note.
- Require a durable exact-identity binding before deriving JSONL or git fields; report/date/name similarity cannot substitute for a session binding.
- Attribute a report artifact only through a recorded positive mapping to `(report, name)` or `(report, session)` with source provenance; otherwise use blank-with-note.
- Derive session fields before overlord fields, not independently; overlord dates and aggregates depend on the reconciled member session rows.
- Require an exact overlord member set and shared base before deriving its date, duration, or file union; `session_count` and report grouping cannot substitute.
- Derive every session `duration_minutes` from its cost row's `plan_time + run_time`, rounded to two decimals; report availability cannot make this conditional.
- Apply the runbook's status, failure, and completed-work-unit semantics to recovered evidence, not an undefined best-effort judgment.
- Amend the header-only outcome sheets in place, not create replacement historical CSVs; the durable reconciliation targets remain the two standard sheets.
- Require `notes` to name the exact binding/source, judgment basis, or unrecoverable reason; generic notes cannot make a row auditable.

## Task checklist

- [ ] Inventory every unique identity in `reports/session-costs.csv` and `reports/overlord-costs.csv`; stop on duplicate cost identities.
- [ ] Bind each report artifact positively to its exact cost identity with provenance before using it; bind JSONL and git evidence durably before deriving their fields.
- [ ] Reconstruct session outcomes under the source-or-blank policy and runbook judgment semantics.
- [ ] Reconstruct overlord outcomes only from exact report evidence and reconciled members with a shared bound base.
- [ ] Add the durable historical-backfill procedure and evidence limits to `v2/docs/outcome-data-source-audit.md`; cross-link it from the operator runbook without weakening normal reconciliation rules.
- [ ] Update the v1 behavior catalog with exact-identity, source-or-blank historical coverage.

## Acceptance criteria

- [ ] Every unique row in `reports/session-costs.csv` joins to exactly one row in `reports/session-outcomes.csv` on `(report, name) -> (report, session_id)`, and no session outcome lacks a matching cost row.
- [ ] Every unique row in `reports/overlord-costs.csv` joins to exactly one row in `reports/overlord-outcomes.csv` on `(report, session) -> (report, session_id)`, and no overlord outcome lacks a matching cost row.
- [ ] The snapshot covers 30 session identities and 3 overlord identities with those bidirectional joins.
- [ ] Every non-blank historical field has an exact identity binding and recorded primary or fallback provenance; JSONL and git fields have their durable session binding, and report similarity alone never supplies a value.
- [ ] Each session `duration_minutes` equals its cost row's `(plan_time + run_time) / 60`, rounded to two decimals; overlord date, duration, and distinct-path file union are populated only with an exact member set and shared base.
- [ ] Recovered statuses, failure reasons, and completed work units follow the runbook semantics; unknown judgment or derivation remains blank with a note naming the evidence, judgment basis, or unrecoverable reason.
- [ ] `v2/docs/outcome-data-source-audit.md` documents the completed historical procedure and evidence limits, and `v1/docs/operator-runbook.md` cross-links it alongside normal reconciliation.
- [ ] `v2/docs/v1-behaviors.md` records exact-identity, source-or-blank coverage without claiming every historical field is recoverable.

## Documentation updates

- Update `v2/docs/outcome-data-source-audit.md` as the durable backfill procedure and evidence-limit contract.
- Update `v1/docs/operator-runbook.md` with a cross-link to that contract.
- Update `v2/docs/v1-behaviors.md` because this extends existing observer reporting behavior.
- Keep `v2/docs/outcome-data-source-audit.md` as the derivation authority; do not duplicate its classification.
