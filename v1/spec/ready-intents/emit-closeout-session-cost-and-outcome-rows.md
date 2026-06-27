---
name: emit-closeout-session-cost-and-outcome-rows
---

# Emit close-out session cost and outcome CSV rows from telemetry

## Problem

The cost-reporting standard requires `reports/session-costs.csv` and
`reports/session-outcomes.csv` rows every session. Today the operator greps run
summaries and hand-converts times/tokens — data jarvis already has in
`~/.jarvis/runs.jsonl` and run/plan summary tables.

## Direction

A jarvis command emits or amends session cost and outcome rows for one
`report` from telemetry — no manual grep or unit conversion.

**Session-costs:** one row per spec/intent in the session; plan + run on the
same row; derive models, costs, times, tokens, and `total_cost` from the
run-summary aggregation path (backed by `runs.jsonl`); record durable bindings
(`namespace`, `run_start_ts`, `run_end_ts`, `run_base`) in `notes` per the
runbook.

**Session-outcomes:** one row per session cost row; join on
`(report, session_id)` → `(report, name)` where `session_id` is the cost-row
`name`; derive fields per
[outcome-data-source-audit.md](../../v2/docs/outcome-data-source-audit.md).

**Idempotency:** amend on `(report, name)` for costs and matching outcome
identity — never duplicate rows within a report.

**Underivable fields:** blank + note — do not invent values (including
`agent_count` without the audit's JSONL filters).

**Decisions**

- Run-summary / JSONL is the sole automatic source — rules out grepping task
  logs or markdown reports.
- Cost rows precede outcome rows in one invocation — rules out emitting
  outcomes without reconciled cost identities for the report.
- Plan-only and blocked-run shapes follow runbook blank-column rules — rules
  out fabricating run-phase figures when no patch run occurred.

Deferred to first consumer: command name and whether this is standalone or
nested under cleanup — pin when the session-end integration intent ships.

## Documentation updates

- `v2/docs/v1-behaviors.md` — session cost/outcome row emission from telemetry.

## Prerequisites

- Run telemetry is persisted to `~/.jarvis/runs.jsonl` with namespace, mode, timestamps, and per-invocation cost/token fields
- Run and plan summary tables aggregate per-spec cost data from telemetry records
- Operator runbook documents session-costs and session-outcomes CSV schemas and identity keys
- Outcome data source audit classifies derivable session-outcome fields and JSONL filters
