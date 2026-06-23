# Backfill historical outcome rows

## Problem

The outcome sheets have headers but no rows while the cost sheets already contain
historical sessions. Backfill both sheets from attributable historical evidence so
each existing cost row has one joining outcome row.

## Decisions

- Backfill every unique current cost-row identity, not only rows with JSONL coverage; unrecoverable fields stay blank with a note.
- Treat a historical report as a fallback source only when it identifies the exact composite cost identity, not merely the same date or similarly named session.
- Derive session fields before overlord fields, not independently; overlord dates and aggregates depend on the reconciled member session rows.
- Amend the header-only outcome sheets in place, not create replacement historical CSVs; the durable reconciliation targets remain the two standard sheets.
- Preserve source uncertainty in `notes`, not replace unknown judgment with zero, completed, or failed.

## Task checklist

- [ ] Inventory every unique identity in `reports/session-costs.csv` and `reports/overlord-costs.csv`; stop on duplicate cost identities.
- [ ] Reconstruct session outcomes from identity-bound report evidence and applicable JSONL data under the source-or-blank policy.
- [ ] Reconstruct overlord outcomes from their exact report evidence and reconciled member session outcomes.
- [ ] Record the historical backfill procedure and evidence limits in the operator runbook without weakening normal reconciliation rules.
- [ ] Update the v1 behavior catalog with the completed historical outcome coverage and its source-or-blank constraint.

## Acceptance criteria

- [ ] Every unique row in `reports/session-costs.csv` joins to exactly one row in `reports/session-outcomes.csv` on `(report, name) -> (report, session_id)`, and no session outcome lacks a matching cost row.
- [ ] Every unique row in `reports/overlord-costs.csv` joins to exactly one row in `reports/overlord-outcomes.csv` on `(report, session) -> (report, session_id)`, and no overlord outcome lacks a matching cost row.
- [ ] Historical outcome values are traceable to an exact cost identity and the documented primary or fallback source; values that cannot be recovered remain blank with an explanatory note rather than fabricated.
- [ ] Session and overlord durations and file counts follow the shared outcome semantics, including session sums and overlord distinct-path unions where the historical evidence supports them.
- [ ] `v1/docs/operator-runbook.md` documents the completed historical backfill and its source-or-blank handling alongside normal reconciliation.
- [ ] `v2/docs/v1-behaviors.md` records that historical cost rows have outcome coverage subject to exact-identity evidence.

## Documentation updates

- Update `v1/docs/operator-runbook.md` as the durable operator/workflow contract.
- Update `v2/docs/v1-behaviors.md` because this extends existing observer reporting behavior.
- Keep `v2/docs/outcome-data-source-audit.md` as the derivation authority; cross-link rather than duplicate its classification.
