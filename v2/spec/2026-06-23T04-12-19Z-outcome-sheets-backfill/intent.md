---
name: outcome-sheets-backfill
---

# Backfill outcome sheets for every existing cost-CSV row

## Behavior

Populate the two outcome sheets retroactively for every row already in
`session-costs.csv` and `overlord-costs.csv`, so outcome data lines up 1:1 with cost
data from day one rather than starting empty. Derive values from the historical
reports under `reports/` (and `~/.jarvis/runs.jsonl` where it reaches back far enough).

Judgment fields that can't be recovered get a best-effort value or a blank with a note
— don't fabricate. After backfill, each existing cost row has a joining outcome row.

## Prerequisites

- The session-outcome and overlord-outcome sheet schemas are defined.
- An outcome-data population standard exists in the operator runbook.
