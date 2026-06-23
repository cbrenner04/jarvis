---
name: outcome-context-data-for-cost-analysis
---

# Capture outcome/context data so cost can be compared to useful work

## Problem

Today's cost reporting (`session-costs.csv`, `overlord-costs.csv`) tracks **spend and token volume**
but not **what the spend bought**. There's no structured way to ask "cost per useful unit of work,"
"how much did we pay for failed/blocked sessions," or "which session types are expensive per
outcome." Token volume ≠ value delivered.

## Direction (keep broad)

Add a **small amount** of outcome/context data alongside the cost CSVs so cost can be joined to
useful work. The goal is minimal additive context, not a heavy analytics layer.

**Two sheets, mirroring the existing cost-CSV split.** Just as cost data splits into
`session-costs.csv` (per spec) and `overlord-costs.csv` (per overlord session), outcome data gets two
parallel sheets that join 1:1 to those:

- **Session-outcome sheet** — one row per Jarvis spec/run, joining to `session-costs.csv`. Uses the
  suggested schema below (work units, success status, session type, duration, files touched, …).
- **Overlord-outcome sheet** — one row per overlord session, joining to `overlord-costs.csv`. Same
  spirit, rolled up to the session (e.g. specs driven, overall success, session type =
  orchestration, total duration, aggregate files touched).

Keep the column vocabulary shared between the two where it makes sense so the sheets stay
aggregatable, the same way the two cost CSVs share fields.

**Backfill the existing rows.** Populate the new outcome sheets retroactively for every row already
in `session-costs.csv` and `overlord-costs.csv`, deriving values from the historical reports under
`reports/` (and `~/.jarvis/runs.jsonl` where it reaches back far enough) so the outcome data lines up
1:1 with the cost data from day one rather than starting empty. Judgment fields that can't be
recovered get a best-effort value or a blank with a note — don't fabricate.

**Lead with a data audit — the real question is "log, or just schema?"** Before adding any logging,
inventory what's *already* captured (`~/.jarvis/runs.jsonl` and the telemetry JSONL already record
agent, model, duration, exit reason, token/cost buckets per run/attempt). For each desired column,
classify it:

1. **Already logged** → the change is **purely a CSV-schema extension** plus a (possibly scripted)
   derivation from existing log fields. Preferred outcome — no harness behavior change.
2. **Derivable but not surfaced** → compute it from existing logs (e.g. `agent_count` /
   `duration_minutes` from `runs.jsonl` rows, `files_touched` from the run's diff).
3. **Genuinely not captured** → only then adjust **logging/telemetry** to emit it, scoped tightly to
   the missing field.

So the work might be entirely "update the CSV schema + a small extractor," or it might need a narrow
logging addition — plan determines which per column, and prefers (1)/(2) over (3).

Suggested CSV shape (starting point — plan refines):

```
session_id,report_date,completed_work_units,success_status,failure_reason,session_type,agent_count,duration_minutes,files_touched,notes
```

Column definitions:

- `session_id` — identifier that joins back to `session-costs.csv`.
- `report_date` — date of the session.
- `completed_work_units` — rough count of useful completed units (specs, tasks, stories, accepted changes).
- `success_status` — `success | partial | failed | blocked | canceled`.
- `failure_reason` — broad category when not successful.
- `session_type` — `planning | implementation | review | debugging | orchestration | cleanup | …`.
- `agent_count` — number of agents/workers involved.
- `duration_minutes` — wall-clock duration of the session.
- `files_touched` — rough count of files changed or meaningfully inspected.
- `notes` — optional human-readable context.

## Open questions (for plan)

- **Who populates it:** automatic (harness emits from run metadata — `runs.jsonl` already has agent
  count, duration, exit reason) vs. hand-filled by the observer in the report. Lean automatic for the
  fields the harness already knows; hand-fill only the judgment fields (`completed_work_units`,
  `success_status`, `notes`).
- **Where it lives:** two new cumulative CSVs under `reports/` (e.g. `session-outcomes.csv` +
  `overlord-outcomes.csv`) paralleling the cost pair, or outcome columns folded into the existing two
  cost CSVs? (Resolved that it's **two sheets** either way — the question is separate files vs. added
  columns.)
- **Determinism:** `completed_work_units` / `success_status` are judgments — record-once like other
  declared signals, don't infer per-run.
- Reconcile with the existing cost-reporting standard (`v1/docs/operator-runbook.md` § Cost reporting
  standard) so the schemas stay aggregatable and joinable.

## Out of scope

- A querying/dashboard layer — this is just capturing the data in CSV form.

## References

- `reports/session-costs.csv`, `reports/overlord-costs.csv` — existing cost schemas to join against.
- `v1/docs/operator-runbook.md` § Cost reporting standard.
- `~/.jarvis/runs.jsonl` — per-run metadata (agent, duration, exit reason) the harness already records.
