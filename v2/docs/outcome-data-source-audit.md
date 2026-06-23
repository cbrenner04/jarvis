# Outcome-data source audit: recorded vs. derivable vs. missing

## Purpose

Before the outcome sheets are implemented, classify which proposed outcome columns the harness already records, which are derivable from existing telemetry, and which genuinely require observer input. This classification drives the outcome schema design and clarifies the contract between harness and observer.

## Recorded telemetry inventory

### Patch telemetry JSONL (`~/.jarvis/runs.jsonl`)

Documented in [v1/docs/run-loop.md](../../../v1/docs/run-loop.md) § Run telemetry file and [v1/docs/quota-signals.md](../../../v1/docs/quota-signals.md) § Patch telemetry.

Per-invocation record fields (append-only, patch mode only):

- `ts`: Unix timestamp of the invocation.
- `run_start_ts`: Unix timestamp at the start of the run (constant across all rows for one spec execution).
- `agent`: The agent CLI name (`claude`, `codex`, `cursor`, etc.).
- `configured_model`: Model string from `modes.patch.agentOrder` entry at invocation time (optional).
- `kind`: Classification of the outcome (`ok`, `quota`, `error`, `timeout`, `model_config`).
- `exitReason`: Semantic category of the outcome (e.g., `quota-exhausted`, `no-progress-fallback`, `agent-error`, `watchdog-iteration-timeout`).
- `mode`: Always `"patch"` (included for Jarvis spec execution context).
- `patch_phase`: Phase name, if available.
- `namespace`: Agent invocation context identifier.
- `usage`: Object with token counts (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; each `number | null`).
- `usage_source`: One of `"agent"`, `"estimated"`, `"unavailable"`, or `null`.
- `cost_usd`: Estimated cost (`number | null`).
- `cost_source`: One of `"computed"`, `"estimated"`, `"unavailable"`, or `null`.
- `record_role`: Optional; `"run_terminal"` marks end-of-run summary rows that mirror `completed-spec` and must not be double-summed.

Watchdog-triggered timeouts may additionally include:

- `watchdog_pgid`: The killed process-group ID.
- `last_output_age_ms`: Milliseconds since the last stdout/stderr chunk at watchdog fire (null if no output arrived).
- `watchdog_descendants_alive`: Boolean indicating whether ≥1 descendant of the agent root pid was live at snapshot (omitted when pgid unavailable).

**Patch telemetry scope:** Only `jarvis1 run` (patch mode) emits JSONL rows. Plan phases (`intent`, `refine`, `name-only`, `draft`, `review`) do not emit matching per-phase outcome records; plan mode has limited telemetry coverage.

### Cost CSV headers

Documented in [v1/docs/operator-runbook.md](../../../v1/docs/operator-runbook.md) § Cost reporting standard.

**`reports/session-costs.csv` columns:**

`report, name, plan_model, plan_cost, plan_time, plan_tokens_in, plan_tokens_out, run_model, run_cost, run_time, run_tokens_in, run_tokens_out, total_cost, notes`

**`reports/overlord-costs.csv` columns:**

`report, session, session_count, model, total_cost, avg_cost_per_spec, api_time, tokens_in, tokens_out, cache_read, cache_write, notes`

Semantics:
- `session_count`: Number of `session-costs.csv` rows (spec count) in this session.
- `avg_cost_per_spec`: `total_cost / session_count` (observer's own cost per spec driven).
- `api_time`: Total API runtime for the session.

## Classification table

Each proposed outcome column is classified as one of:

- **Already-logged**: The harness records this field directly in JSONL or CSV.
- **Derivable**: The harness records sufficient source data; a deterministic derivation computes the outcome.
- **Not-captured**: The harness does not record this data; observer input or best-effort fallback required.
- **Derived-hint + observer-override**: Hybrid status fields where the harness provides a derived hint (e.g., `exitReason`-based success probability) but the observer can override with judgment.

### Session-sheet proposed columns

| Column | Classification | Source / Derivation | Notes |
|--------|----------------|---------------------|-------|
| `session_id` | Join key (cost CSV) | From `reports/session-costs.csv` `name` field | Not an outcome; matches spec identifier in cost CSV |
| `report_date` | Derivable | From `run_start_ts` (first JSONL row `ts`); convert to date | Or from `report` field in cost CSVs if present |
| `completed_work_units` | Not-captured | Observer judgment | Count of checked acceptance criteria at session end; harness does not track intent of checklist items |
| `success_status` | Derived-hint + observer-override | Hint from final `exitReason` (`ok` → successful, `error`/`quota`/`timeout` → failure); observer overrides | Harness emits `exitReason` (quota-exhausted, agent-error, watchdog-iteration-timeout, etc.); observer records actual outcome intent (e.g., partial progress) |
| `failure_reason` | Derived-hint + observer-override | Hint from `exitReason` and `kind`; observer records if not captured | If `success_status` is failure, harness provides signal (quota, agent-error, timeout, model-config); observer may clarify |
| `session_type` | Already-logged | From `mode` field in JSONL (always `"patch"` for patch runs) | For plan/intent runs, recorded by observer; for patch, always `"patch"` |
| `agent_count` | Derivable | Distinct agent names in JSONL, excluding `record_role: "run_terminal"` rows and synthetic `agent: "harness"` rows | Filter: count unique `agent` values where `record_role ≠ "run_terminal"` and `agent ≠ "harness"` |
| `duration_minutes` | Derivable | From `reports/session-costs.csv` `plan_time` and `run_time` fields (already-logged); convert to minutes. If CSV unavailable, fallback to `max(ts) - min(ts)` from JSONL and convert ms to minutes | CSV source preferred: cost standard already records duration per phase |
| `files_touched` | Derivable | From run git diff (paths of added/modified/deleted files); count or list | Run-end git diff is reliably persisted post-run; if diff is deleted, recompute from git history (e.g., `git diff HEAD~1` if the spec commit is known). Reliability: stable once committed |
| `notes` | Not-captured | Observer recorded | Free-form context; harness does not record per-spec notes |

### Overlord-sheet proposed roll-up columns

| Column | Classification | Source / Derivation | Notes |
|--------|----------------|---------------------|-------|
| `specs_driven` | Already-logged | From `reports/overlord-costs.csv` `session_count` field | Number of `session-costs.csv` rows in this overlord session; cost CSV already records it |
| `overall_success` | Derived-hint + observer-override | Hint: count session-sheet `success_status` outcomes; observer overrides if needed | Harness can count successful sessions from JSONL; observer may record aggregate judgment (e.g., "partial success") |
| `session_type` | Already-logged | From `reports/overlord-costs.csv` implicit context; overlord sessions have `session_type = "orchestration"` | Not per-spec; marks the row as overlord-generated (value always `"orchestration"`) |
| `total_duration` | Already-logged | From `reports/overlord-costs.csv` `api_time` field (total API runtime); or sum of `plan_time + run_time` across all rows in the session | API time is already recorded; alternative: aggregate per-spec durations |
| `aggregate_files_touched` | Not-captured (with caveat) | Candidate: union of all `files_touched` across specs in the session; limited by patch-only telemetry | **Blocker:** Plan phases do not emit per-phase telemetry rows, so plan-driven specs contribute no file activity to JSONL. Harness cannot reliably derive aggregate files for mixed plan+patch sessions. Follow-up: observer records or derives from post-run git history (e.g., diff against main branch at session start). |

## Derivation details

### `agent_count`

Filter patch JSONL rows by:
1. Exclude `record_role: "run_terminal"` (end-of-run summaries that duplicate `completed-spec`).
2. Exclude synthetic `agent: "harness"` rows (bookkeeping entries).
3. Count distinct `agent` values in the remaining set.

Example (pseudo-SQL): `SELECT COUNT(DISTINCT agent) FROM runs WHERE ts BETWEEN start AND end AND record_role != "run_terminal" AND agent != "harness"`

A naive row count is incorrect if an iteration produced both a real invocation and a terminal duplicate.

### `duration_minutes`

**Primary source:** From `reports/session-costs.csv`, sum `plan_time + run_time` and convert to minutes.

**Fallback (if CSV unavailable):** From JSONL, compute `(max(ts) - min(ts)) / 1000 / 60` (milliseconds to minutes).

The cost CSV is the authoritative source because it already records per-phase durations independently. Fallback to JSONL only if the CSV row is missing.

### `files_touched`

**Source:** Run git diff. At the end of a `jarvis1 run`, the worktree contains a checked-in commit with all changes. Extract files:

```bash
git diff HEAD~1 --name-only
```

Or, if the spec base is known:
```bash
git diff <spec-base> --name-only
```

Count distinct file paths or store as a list (format per schema design).

**Persistence:** The run diff is committed to git and persists post-run, so it is reliably available for later audit (e.g., from `reports/` after the run completes). If the worktree is deleted without committing, the diff is lost; recovery requires `git log` on the target repo.

### `success_status` (hybrid derived-hint + observer-override)

**Harness-provided hint:** The final `exitReason` in the JSONL:

- `exitReason: "ok"` or `"no-progress-fallback"` with `kind: "ok"` → hint: successful / partial progress.
- `exitReason: "quota-exhausted"`, `"agent-error"`, `"watchdog-iteration-timeout"`, `"model-config"` → hint: failure.

**Operator override:** The observer records the actual outcome intent (e.g., "partial progress" even if an iteration returned `error`, or "blocker added" even if the run exited 0).

### `failure_reason` (hybrid derived-hint + observer-override)

**Harness-provided hint:** If `success_status` is failure, the `kind` and `exitReason` fields indicate the signal:

- `kind: "quota"` with `exitReason: "quota-exhausted"` → hint: "quota exhausted; all fallback agents exhausted".
- `kind: "error"` with `exitReason: "agent-error"` → hint: "agent returned non-zero exit".
- `kind: "timeout"` → hint: "iteration or run timeout".
- `kind: "model_config"` → hint: "model configuration error".

**Operator override:** If not captured by `exitReason`, the observer notes the actual reason (e.g., "intentional blocker added", "plan phase diverged").

## Scope constraints and follow-ups

### Plan-phase telemetry gap

Plan mode (spec drafting) does not emit per-phase JSONL outcome rows. Only the final plan invocation result is recorded. This affects:

- **`agent_count` for plan phases:** Harness does not count individual agent invocations during refine/draft phases.
- **`aggregate_files_touched` (overlord sessions with plan):** Plan-driven specs do not contribute file activity to JSONL; files touched during plan phases cannot be derived from patch JSONL alone.

**Follow-up:** These fields require observer input or derivation from git history when plan phases are involved. A future telemetry extension may emit per-plan-phase rows, but that is out of scope here.

### Not-captured columns requiring observer input

- **`completed_work_units`:** The checklist is visible only to the observer; the harness does not parse acceptance-criteria intent.
- **`notes`:** Observer-recorded free-form context.
- **`failure_reason` (when not captured by `exitReason`):** If a run exits 0 but the observer notes "spec refined to avoid implementation" or similar, the harness has no signal.
- **`overall_success` (overlord):** Aggregate judgment by the observer.

These are recorded once by the observer post-session, not derived per iteration.

### No harness behavior change

This audit is a **classification only**. It documents what is already recorded and what is derivable; it makes no changes to:

- Telemetry JSONL schema or emission.
- Cost CSV columns or values.
- Run git diff persistence.

The harness continues to emit the same telemetry fields. Outcome sheet implementation consumes these fields and combines them with observer input per this classification.

## Acceptance: no captured-column misclassification

For completeness, verify that no proposed column is classified not-captured when a derivation from a documented telemetry field or cost-CSV header exists:

- ✓ `session_id`, `report_date`, `session_type`, `duration_minutes`, `files_touched`: All traceable to JSONL or cost CSV.
- ✓ `agent_count`: Derived from distinct `agent` in JSONL; filter defined.
- ✓ `success_status`, `failure_reason`: Hybrid derived-hint + override; hint sourced from `exitReason`/`kind`.
- ✓ `specs_driven`, `overall_success` (partial), `total_duration`: Already-logged or derivable from cost CSV.
- ✗ `completed_work_units`, `notes`, `aggregate_files_touched` (plan caveat): Correctly classified not-captured or caveated.

All derivations trace to committed documentation (`v1/docs/run-loop.md`, `v1/docs/quota-signals.md`, `v1/docs/operator-runbook.md`).
