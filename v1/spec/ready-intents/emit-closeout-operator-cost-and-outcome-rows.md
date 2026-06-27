---
name: emit-closeout-operator-cost-and-outcome-rows
---

# Emit close-out operator cost and outcome CSV rows from `/cost`

## Problem

The cost-reporting standard requires `reports/operator-costs.csv` and
`reports/operator-outcomes.csv` rows every session. Operator spend comes from
Claude Code `/cost`, which jarvis cannot capture in-session — so the operator
pastes it by hand today.

## Direction

Extend the close-out cost command to accept the operator's `/cost` output
(flag, stdin, or file), parse the fields the standard expects, and emit or
amend operator cost and outcome rows for one `report`.

**Operator-costs:** one row per operator session; parse `total_cost`, `api_time`,
tokens, cache, and any lines-changed figure the standard names; compute
`session_count` and `avg_cost_per_spec` from the session's `session-costs`
member set for that `report`; record the member `(report, name)` set and
`session_base` in `notes`.

**Operator-outcomes:** one row per operator cost row; join on
`(report, session_id)` → `(report, session)`; derive fields per
[outcome-data-source-audit.md](../../v2/docs/outcome-data-source-audit.md)
(`specs_driven` from cost-row `session_count`, `report_date` from matched
session outcomes, etc.).

**Idempotency:** amend on `(report, session)` — never duplicate operator rows
within a report.

**Underivable fields:** blank + note — do not invent operator figures beyond
what `/cost` and bound session rows supply.

## Decisions

- `/cost` is operator-supplied at close-out — rules out in-session capture or
  telemetry inference of operator spend.
- Aggregates (`session_count`, `avg_cost_per_spec`) come from emitted
  `session-costs` rows for the same `report` — rules out a separate manual spec
  count.
- Operator outcome derivations require bound session-cost/outcome identities —
  rules out writing operator outcomes before session sheets exist for the
  report.

Deferred to first consumer: whether operator input is a required flag vs
optional stdin default — pin when the integration intent wires session-end UX.

## Documentation updates

- `v2/docs/v1-behaviors.md` — operator cost/outcome row emission from `/cost`
  input (if not already covered by the session intent's entry).

## Prerequisites

- Session cost and outcome rows for the report can be emitted or already exist in `reports/session-costs.csv` and `reports/session-outcomes.csv`
- Operator runbook documents operator-costs and operator-outcomes CSV schemas, identity keys, and `/cost` as the operator source
- Outcome data source audit classifies operator-outcome derivations and join rules
