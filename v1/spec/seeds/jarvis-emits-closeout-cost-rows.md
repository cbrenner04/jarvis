# Jarvis emits the close-out cost CSV rows (stop hand-assembling them)

## Problem

The cost-reporting standard (operator runbook) requires four cumulative CSVs —
`session-costs`, `operator-costs`, `session-outcomes`, `operator-outcomes` — each
appended every session. It is **documented but verbalized**, so it gets missed
repeatedly (incl. 2026-06-27, only caught when the owner asked). The operator
hand-assembles rows by grepping run summaries out of task logs and converting
times/tokens by hand — exactly the manual toil a guardrail should remove.

A runbook instruction is a reminder, not a guardrail. The fix is to **build** the
emission.

## Direction

A jarvis command emits the per-session CSV rows from data jarvis already has,
appending to the four `reports/*.csv` files with the standard columns:

- **`session-costs` / `session-outcomes`** rows: derive from `runs.jsonl` (or the
  run-summary data jarvis prints) per spec — `name`, plan/run model, cost, time,
  tokens, `total_cost`; outcome `completed_work_units`, `success_status` (from exit
  reason), `session_type`, `agent_count`, `duration_minutes`, `notes`. The data
  behind the printed run/plan summary tables is the source.
- **`operator-costs` / `operator-outcomes`** rows: the operator pastes their Claude
  Code `/cost` (not capturable in-session); the command takes it (flag/stdin/file),
  parses `total_cost`, `api_time`, tokens, cache, lines-changed, and writes the row
  with `session_count` / `avg_cost_per_spec` computed from the session's spec set.

Shape (weigh in plan): fold into `jarvis1 cleanup` close-out, or a dedicated
`jarvis1 report` that the operator runs once at session end. Must be idempotent
(re-run amends the session's rows, never duplicates — keyed on `report`), and must
respect the standard's "blank + note when a field can't be derived" rule rather
than inventing values.

Done-state: the four CSVs are populated by running a jarvis command, not by hand;
a session can't close with the cost sheets silently empty.

## Documentation updates

- `v1/docs/operator-runbook.md` — Cost reporting standard: the CSVs are emitted by
  `<the command>`, not hand-assembled; **delete** the manual-assembly framing once
  this ships.
- `v2/docs/v1-behaviors.md` — record the close-out cost-row emission command.
