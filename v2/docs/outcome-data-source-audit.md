# Outcome-data source audit: recorded vs. derivable vs. missing

## Purpose

Before the outcome sheets are implemented, classify which proposed outcome columns the harness already records, which are derivable from existing telemetry, and which genuinely require operator input. This classification drives the outcome schema design and clarifies the contract between harness and operator.

## Recorded telemetry inventory

### Patch telemetry JSONL (`~/.jarvis/runs.jsonl`)

Documented in [v1/docs/run-loop.md](../../../v1/docs/run-loop.md) § Run telemetry file and [v1/docs/quota-signals.md](../../../v1/docs/quota-signals.md) § Patch telemetry.

Per-invocation record fields (append-only, patch mode only):

- `ts`: Unix timestamp in milliseconds of the invocation.
- `run_start_ts`: Unix timestamp in milliseconds at the start of the run (constant across all rows for one spec execution).
- `agent`: The agent CLI name (`claude`, `codex`, `cursor`, etc.).
- `configured_model`: Model string from `modes.patch.agentOrder` entry at invocation time (optional).
- `kind`: Classification of the outcome (`ok`, `quota`, `error`, `timeout`, `model_config`).
- `exitReason`: Semantic category of the outcome (e.g., `quota-exhausted`, `no-progress-fallback`, `watchdog-idle-timeout-fallback`, `agent-error`, `watchdog-iteration-timeout`).
- `mode`: Always `"patch"` (included for Jarvis spec execution context).
- `patch_phase`: Phase name, if available.
- `namespace`: Agent invocation context identifier.
- `usage`: Object with token counts (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; each `number | null`).
- `usage_source`: One of `"agent"`, `"estimated"`, `"unavailable"`, or `null`.
- `cost_usd`: Estimated cost (`number | null`).
- `cost_source`: One of `"computed"`, `"estimated"`, `"unavailable"`, or `null`.
- `record_role`: Optional; `"run_terminal"` marks end-of-run summary rows that mirror `completed-spec` and must not be double-summed.

Non-terminal per-rung rows (`no-progress-fallback`, `watchdog-idle-timeout-fallback`, `quota-fallback`, `probable-quota-fallback`) record ladder advances without ending the run. `watchdog-idle-timeout-fallback` uses `kind: "timeout"` (unlike `no-progress-fallback`, which uses `kind: "ok"`). Run-level outcome hints (`success_status`, `failure_reason`) derive from the final identity-bound row — typically terminal `watchdog-idle-timeout`, `no-progress`, or `completed-spec`, not the intermediate fallback rows.

Watchdog-triggered timeouts may additionally include:

- `watchdog_pgid`: The killed process-group ID.
- `last_output_age_ms`: Milliseconds since the last stdout/stderr chunk at watchdog fire (null if no output arrived).
- `watchdog_descendants_alive`: Boolean indicating whether ≥1 descendant of the agent root pid was live at snapshot (omitted when pgid unavailable).

**Patch telemetry scope:** Only `jarvis1 run` (patch mode) emits JSONL rows. Plan phases (`intent`, `refine`, `name-only`, `draft`, `review`) do not emit matching per-phase outcome records; plan mode has limited telemetry coverage.

### Cost CSV headers

Documented in [v1/docs/operator-runbook.md](../../../v1/docs/operator-runbook.md) § Cost reporting standard.

**`reports/session-costs.csv` columns:**

`report, name, plan_model, plan_cost, plan_time, plan_tokens_in, plan_tokens_out, run_model, run_cost, run_time, run_tokens_in, run_tokens_out, total_cost, notes`

**`reports/operator-costs.csv` columns:**

`report, session, session_count, model, total_cost, avg_cost_per_spec, api_time, tokens_in, tokens_out, cache_read, cache_write, notes`

Key columns: `session_count` is the number of `session-costs.csv` rows (spec count); `api_time` is total API runtime.

## Classification table

Each proposed outcome column is classified as one of:

- **Already-logged**: The harness records this field directly in JSONL or CSV.
- **Derivable**: The harness records sufficient source data; a deterministic derivation computes the outcome.
- **Pinned constant**: The value is a fixed constant (not variable per run/spec) and derives from context rather than recorded data.
- **Not-captured**: The harness does not record this data; operator input or best-effort fallback required.
- **Derived-hint + operator-override**: Hybrid status fields where the harness provides a derived hint (e.g., `exitReason`-based success probability) but the operator can override with judgment.

### Session-sheet proposed columns

| Column | Classification | Source / Derivation | Notes |
|--------|----------------|---------------------|-------|
| `session_id` | Join key (cost CSV) | From `reports/session-costs.csv` `name` field | Not an outcome; matches spec identifier in cost CSV |
| `report_date` | Derivable | From `run_start_ts` in the JSONL rows durably bound to `(report, name)`; convert to date | Requires a durable binding from the session cost identity to one JSONL namespace and run window; without that binding or source row, leave blank |
| `completed_work_units` | Not-captured | Operator judgment | Count of completed subspecs at session end (single-file spec = 1); harness does not track subspec/criterion intent |
| `success_status` | Derived-hint + operator-override | Hint from the final identity-bound JSONL `exitReason` (`ok` → successful, `error`/`quota`/`timeout` → failure); operator overrides | Without the durable JSONL binding, the hint is unavailable and judgment stays operator-provided |
| `failure_reason` | Derived-hint + operator-override | Hint from the final identity-bound JSONL `exitReason` and `kind`; operator records if not captured | If `success_status` is failure, harness provides signal (quota, agent-error, timeout, model-config) only when the JSONL binding is durable |
| `session_type` | Already-logged | From `mode` field in the identity-bound JSONL rows (always `"patch"` for patch runs) | For plan/intent runs, recorded by operator; for patch, only when the JSONL binding is durable |
| `agent_count` | Derivable | Distinct agent names in the identity-bound JSONL rows, excluding `record_role: "run_terminal"` rows and synthetic `agent: "harness"` rows | Filter: count unique `agent` values where `record_role ≠ "run_terminal"` and `agent ≠ "harness"` |
| `duration_minutes` | Derivable | From `reports/session-costs.csv` `plan_time` and `run_time` fields (in seconds, already-logged); sum and convert to minutes | Cost row is the primary and only automatic source in the standard |
| `files_touched` | Derivable | From the run-base git diff bound durably to `(report, name)` | Requires the session cost identity to carry its run base; absent that binding, leave blank |
| `notes` | Not-captured | Operator recorded | Free-form context; harness does not record per-spec notes |

### Operator-sheet proposed roll-up columns

| Column | Classification | Source / Derivation | Notes |
|--------|----------------|---------------------|-------|
| `specs_driven` | Already-logged | From `reports/operator-costs.csv` `session_count` field | Number of `session-costs.csv` rows in this operator session; cost CSV already records it |
| `overall_success` | Derived-hint + operator-override | Hint: aggregate per-session `success_status` (derived hints from `exitReason`); operator overrides if needed | Harness derives per-session success hints from JSONL `exitReason` and aggregates across the session; operator may record aggregate judgment (e.g., "partial success") |
| `session_type` | Pinned constant | Value is always `"orchestration"` for operator sheets (not recorded in CSV, derived from sheet context) | Not per-spec; marks the row as operator-generated |
| `report_date` | Derivable | Earliest matched session outcome date across the exact member `(report, name)` set bound to `(report, session)` | Requires a durable mapping from the operator cost identity to its member session-cost identities; `session_count` alone is insufficient |
| `duration_minutes` | Derivable | Sum `plan_time + run_time` across the exact member session-cost rows bound to `(report, session)` | Do not substitute `api_time`; without exact member mapping, leave blank |
| `files_touched` | Derivable (with caveat) | Distinct-path union across the exact member session set from the shared bound `session_base` | Requires a durable member mapping plus session base; without both, leave blank |

## Derivation details

### `agent_count`

Filter the JSONL rows durably bound to one session cost identity by:
1. Exclude `record_role: "run_terminal"` (end-of-run summaries that duplicate `completed-spec`).
2. Exclude synthetic `agent: "harness"` rows (bookkeeping entries).
3. Count distinct `agent` values in the remaining set.

Example (pseudo-SQL): `SELECT COUNT(DISTINCT agent) FROM runs WHERE ts BETWEEN start AND end AND record_role != "run_terminal" AND agent != "harness"`

A naive row count is incorrect if an iteration produced both a real invocation and a terminal duplicate. JSONL fields alone do not identify `(report, name)`: the operator must first bind that cost identity to one `namespace`, one `run_start_ts`, and one `run_end_ts` in the matching `session-costs.csv` `notes`.

### `duration_minutes`

**Primary source:** From `reports/session-costs.csv`, sum `plan_time + run_time` (both in seconds) and convert to minutes by dividing by 60.

The cost CSV is the authoritative source because it already records per-phase durations independently. The reporting standard does not allow substituting a JSONL timestamp span for this field.

### `files_touched`

**Source:** Run git diff. At the end of a `jarvis1 run`, the worktree contains a checked-in commit with all changes. Since Jarvis commits per iteration, the correct diff is against the run base bound to the session cost identity, not just the final commit. Extract files:

**Primary:**
```bash
git diff <spec-base> --name-only
```
(where `<spec-base>` is the run base recorded in the matching `session-costs.csv` `notes`)

Count distinct file paths or store as a list (format per schema design).

**Fallback:** A weaker git fallback is allowed only when every included commit is uniquely attributable to the same cost identity. `HEAD~1` is not an acceptable general fallback because it is not identity-bound.

**Persistence:** The run diff is committed to git and persists post-run, so it is reliably available for later audit. If the worktree is deleted without preserving the bound run base, the field becomes blank-with-note rather than inferred.

### Identity bindings required for automatic derivation

Automatic derivation is only executable after the operator records two durable bindings in the cost rows and mirrored markdown report:

1. Session binding: `(report, name) -> namespace + run_start_ts + run_end_ts + run_base`
2. Operator binding: `(report, session) -> exact member (report, name) set + session_base`

Use the session binding for initial reconciliation, reruns, and corrections. On amendment, keep the same cost identity and update the binding in place to the corrected window/base. Use the operator binding the same way for aggregate fields. Without these bindings, JSONL-derived session fields and aggregate operator date/duration/file fields remain blank with a note.

## Historical backfill procedure

Use this only for the legacy header-only outcome sheets.

1. Inventory `reports/session-costs.csv` on `(report, name)` and `reports/operator-costs.csv` on `(report, session)`. Stop on duplicate cost identities.
2. Bind each historical session cost row before deriving JSONL- or git-backed fields:
   - Primary binding: exact `plan`/`patch` namespace windows plus the original `run_base`.
   - Git fallback: if `run_base` was not preserved, use an exactly attributable merged squash diff `(<parent>..<commit>)` for that same cost identity. Otherwise leave git-backed fields blank.
3. Record recovered session bindings in `reports/session-costs.csv` `notes`, and recovered operator member sets plus `session_base` in `reports/operator-costs.csv` `notes`. Historical markdown reports may stay unchanged.
4. Reconcile `reports/session-outcomes.csv` one row per unique session cost identity. Derive:
   - `report_date` from the bound patch namespace start, or the bound plan namespace start for plan-only rows.
   - `agent_count` only from bound patch telemetry; leave plan-only counts blank unless exact operator evidence survives.
   - `duration_minutes` only from that cost row's `plan_time + run_time`.
   - `files_touched` only from the bound run diff or exact merged-squash fallback.
   - `success_status`, `failure_reason`, and `completed_work_units` from runbook judgment semantics; leave unknown judgment blank with a note.
5. Reconcile `reports/operator-outcomes.csv` one row per unique operator cost identity only after recording the exact member session set and shared `session_base`. Derive:
   - `report_date` from the earliest matched member outcome date.
   - `duration_minutes` from the sum of exact member session-cost durations.
   - `files_touched` from the distinct-path union across exact member session diffs.
6. Every non-blank historical field must cite its exact binding or fallback provenance in `notes`. Report/date/name similarity is never enough.

## Historical evidence limits

- Historical patch rows without an exact namespace binding cannot populate JSONL-derived fields.
- Historical git-backed fields stay blank when no exact run diff or exact merged-squash fallback survives.
- Historical operator rows stay blank for derived date, duration, and files when the exact member set or shared `session_base` is missing.
- Historical plan-only rows may record `report_date`, `duration_minutes`, and operator judgment from the exact plan namespace, but `agent_count` stays blank unless exact operator evidence survives.

## Scope constraints and follow-ups

### Plan-phase telemetry gap

Plan mode (spec drafting) does not emit per-phase JSONL outcome rows. Only the final plan invocation result is recorded. This affects:

- **`agent_count` for plan phases:** Harness does not count individual agent invocations during refine/draft phases.

**Follow-up:** Plan-phase `agent_count` requires operator input when plan phases are involved. A future telemetry extension may emit per-plan-phase rows, but that is out of scope here.

### Not-captured columns requiring operator input

- **`completed_work_units`:** Counts completed subspecs (single-file spec = 1); the index/checklist is visible only to the operator, and the harness does not parse subspec or acceptance-criterion intent.
- **`notes`:** Operator-recorded free-form context.
- **`failure_reason` (when not captured by `exitReason`):** If a run exits 0 but the operator notes "spec refined to avoid implementation" or similar, the harness has no signal.

Judgment columns (`overall_success` for operator, `success_status` and `failure_reason` overrides for session) are hybrid: the harness provides derived hints, and the operator may override with judgment post-session.

### No harness behavior change

This audit and backfill contract document existing evidence only. They make no changes to:

- Telemetry JSONL schema or emission.
- Cost CSV columns or values.
- Run git diff persistence.

The harness continues to emit the same telemetry fields. Outcome sheet implementation consumes these fields and combines them with operator input per this classification.
