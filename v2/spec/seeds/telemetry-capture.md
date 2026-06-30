---
name: telemetry-capture
---

# v2 telemetry capture — first-class facts for later analysis

Operators reconciling Jarvis session data hit structural friction: five
`reports/*.csv` files, `~/.jarvis/runs.jsonl`, operator `/cost` or opencode
SQLite, and durable bindings stuffed into CSV `notes` (`plan_ns=…`,
`patch_ns=…`, `git_fallback=…`). The spreadsheets are not the root problem —
they are a **late reconciliation layer** on fragmented, weakly keyed sources.

v2 already has a durable ID spine (`run_id`, `attempt_id`) and an explicit
persistence split (orchestration store vs observability log stream). It does
**not** yet define where **analysis facts** live or how they are emitted.
Vision says the host/runner owns telemetry; architecture says token/cost streams
stay out of `v2.sqlite`; nothing pins the third artifact.

This seed is **documentation only**: produce a durable reference doc future
planners and implementers use as the capture contract. No code, no event sink,
no backfill of v1 data, no export commands, no analysis tooling.

## Problem (concrete v1 pain)

1. **Capture is late** — cost/outcome rows are assembled when the operator
   closes a report, not when invocations happen.
2. **Identity is reconstructed** — `namespace` + timestamp windows + git refs in
   `notes` because nothing stamps `run_id` / `attempt_id` / `invocation_id` at
   source.
3. **Grain mismatch** — operator session, Jarvis spec/intent, run, attempt, and
   per-agent invocation are different entities joined by hand on
   `(report, name)` / `(report, session)`.
4. **Behavior coverage gaps** — v1 `runs.jsonl` is patch-heavy; plan phases
   emit thin or no matching rows; review/orchestration roll-ups hit the same
   gap ([outcome-data-source-audit.md](../../docs/outcome-data-source-audit.md)).
5. **CSVs as source of truth** — `efficiency.csv` and outcome sheets are
   derived snapshots that operators maintain as if primary.

The audit doc classifies which outcome columns are already-logged, derivable,
or operator judgment. The capture doc should **eliminate the binding step** for
everything the harness knows at emission time, and mark judgment fields
explicitly as a thin annotation layer — not a re-entry of cost/duration/agents.

## Goal

One reference doc that answers, for any future implementer:

- What are the three persistence roles (orchestration / observability /
  telemetry)?
- What events/facts are emitted, at which code boundary, with which schema?
- Which stable IDs join facts across stores without manual `notes` binding?
- What is intentionally **not** captured (operator judgment, transcripts)?
- Where in [v2-build-order.md](../../docs/v2-build-order.md) emission lands?
- How v1 CSV reporting becomes a **derived export**, not a capture path?

## Scope (for plan → run)

- New durable home: `v2/docs/telemetry-capture.md` (name negotiable in plan;
  prefer `telemetry-capture` over `analytics` — capture contract, not query
  layer).
- Cross-links only (no duplication of full schemas elsewhere):
  - [v2-architecture.md](../../docs/v2-architecture.md) — Persistence /
    Observability log stream sections: one paragraph + link establishing the
    third store.
  - [v2-build-order.md](../../docs/v2-build-order.md) — cross-cutting bullet
    for telemetry capture sequencing.
  - [shared-step-runner.md](../../docs/shared-step-runner.md) and
    [shared-invocation.md](../../docs/shared-invocation.md) — emission boundary
    pointers.
  - [state-store.md](../../docs/state-store.md) — reaffirm what stays out of
    orchestration rows.
  - [outcome-data-source-audit.md](../../docs/outcome-data-source-audit.md) —
    backward link: audit classifications inform which v1 outcome fields become
    harness-emitted vs operator-annotated in v2.
- Optional one-line pointer in [v2-vision.md](../../docs/v2-vision.md) under
  host/runner responsibilities if the plan finds a natural home.

**Fan-out:** Prefer **one** ready-intent ("telemetry capture reference doc").
Do not split implementation slices here — this seed is doc-only.

## Out of scope

- Any runtime code (types, sink, reader, CLI, daemon RPC).
- Backfill or migration of `~/.jarvis/runs.jsonl`, `reports/*.csv`, or
  historical operator reports.
- v1 harness changes (operator-runbook CSV workflow stays until v2 parity +
  export exists).
- Analysis features: DuckDB views, SQL query layer, dashboards, ad-hoc report
  generators, Parquet, BI tooling.
- Changing `v2.sqlite` schema to hold token/cost/usage (explicitly forbidden
  by architecture — reference doc must say why).
- Replacing or extending the **loop observability** log stream
  (`iteration_started`, `boundary_committed`, …) with invocation telemetry —
  those are different consumers; doc must keep them separate.

## Decisions (seed-level — refine in plan, pin in reference doc)

### 1. Three-store model

| Store | Path (production default) | Role | Consumer |
| --- | --- | --- | --- |
| **Orchestration** | `~/.jarvis/state/v2.sqlite` | Resume/recovery: run lifecycle, attempt outcomes, checkpoint | Write loop, workflow runner, daemon `wait` |
| **Observability** | injectable (e.g. shared `logs.jsonl`) | Live tail/follow: loop lifecycle events | TUI log follow, daemon IPC tail |
| **Telemetry / facts** | injectable (e.g. `~/.jarvis/telemetry.jsonl`) | Append-only analysis substrate: per-invocation and boundary facts | Future export, offline analysis (DuckDB, jq, notebooks) — **not** harness recovery |

Rules:

- Recovery **never** reads telemetry; orchestration store + git worktree remain
  the resume source ([v2-architecture.md](../../docs/v2-architecture.md)
  Recovery).
- Observability log **never** substitutes for telemetry — loop events lack
  usage/cost/model/agent per invocation.
- Telemetry **never** writes to orchestration tables — keeps SQLite narrow and
  migration-safe.

### 2. Event grains

Define these grains in the reference doc so planners do not conflate them:

| Grain | ID | Emitted when | Examples |
| --- | --- | --- | --- |
| **Operator session** | `operator_session_id` | CLI/daemon session start (or first `start` in a TTY session) | Roll-up across multiple runs while operator is at keyboard |
| **Run** | `run_id` | `createRun` | Workflow instance, project, branch, spec_ref |
| **Attempt** | `attempt_id` | `recordAttemptStart` | One step try within a loop |
| **Invocation** | `invocation_id` | Each `execute` through binding chain (including quota fallbacks as separate rows or explicit sub-rows — plan must pick one and document tradeoff) | Agent call: tokens, cost, model, duration, exit |
| **Boundary** | `attempt_id` + commit metadata | `commitCompletionBoundary` | `commit_sha`, `files_changed`, outcome_kind |

v1's `(report, name)` and `(report, session)` keys are **reporting labels**,
not durable harness IDs. v2 facts carry `run_id` / `attempt_id` at emission;
report name is optional denormalized context for export compatibility.

### 3. Emission boundaries (where code will eventually hook)

Pin these boundaries in the doc even though implementation is deferred:

1. **Per-invocation** — shared invocation layer (`shared/invocation/execute.ts`
   or immediate wrapper): after each agent subprocess settles, emit
   `invocation_completed` with usage/cost/agent/model/exit_reason and full ID
   context passed in from the runner (runner must not re-parse logs to recover
   IDs).
2. **Per-attempt start** — optional `attempt_started` if observability log and
   telemetry need different shapes; default: rely on orchestration +
   observability for attempt start, telemetry for invocation + boundary only.
3. **Per-boundary** — write loop / workflow runner at
   `commitCompletionBoundary`: emit `boundary_committed` **telemetry** row
   (distinct from observability `boundary_committed` event) with work facts:
   `commit_sha`, `files_changed` count and/or path list, `outcome_kind`,
   `run_status`. Plan may alias naming to avoid collision — e.g.
   `work_boundary_recorded` for telemetry vs loop observability event kinds.
4. **Run terminal** — `loop_finished` / run failure: emit `run_terminal` row
   mirroring v1 `record_role: "run_terminal"` semantics — exit summary without
   double-counting invocation usage in roll-ups.

**Cross-behavior:** Same event schema for write, review-debate, and plan steps;
only `workflow`, `step_id`, `role`, and optional `phase` fields differ. No
patch-only telemetry.

### 4. Suggested event schema (reference doc should nail this)

Use JSONL lines; one `record` object per line. Suggested top-level shape:

```json
{
  "schema_version": 1,
  "record_kind": "invocation_completed",
  "ts": "ISO-8601",
  "operator_session_id": "uuid-or-stable-string",
  "run_id": "uuid",
  "attempt_id": "uuid",
  "invocation_id": "uuid",
  "project": "string",
  "workflow": "string",
  "step_id": "string",
  "role": "implement|plan|adversary|…",
  "agent": "claude|codex|cursor|…",
  "model": "string",
  "binding_index": 0,
  "duration_ms": 12345,
  "usage": {
    "input_tokens": null,
    "output_tokens": null,
    "cache_read_input_tokens": null,
    "cache_creation_input_tokens": null
  },
  "usage_source": "agent|estimated|unavailable|null",
  "cost_usd": null,
  "cost_source": "computed|estimated|unavailable|null",
  "exit_kind": "ok|quota|error|timeout|model_config|…",
  "exit_reason": "string",
  "worktree_path": "string",
  "branch": "string",
  "spec_ref": "string"
}
```

Separate `record_kind` variants (doc lists required fields per kind):

- `invocation_completed` — per agent call (required fields above).
- `work_boundary_recorded` — git/work facts at boundary commit.
- `run_terminal` — run-level summary; exclude from usage roll-ups (v1 parity).

Optional denormalized fields for export compatibility (not join keys):

- `report_label` — operator-chosen session report slug if set at run start.
- `spec_display_name` — human label for the spec/intent.

**Null semantics:** Explicit `null` vs omitted — doc must pick one (recommend:
emit keys with `null` for unavailable usage/cost so analysis queries do not
need "key absent" vs "unavailable" branching).

### 5. Operator session model

An operator session is not a separate manual CSV row. Doc should define:

- Assigned at daemon `start` or CLI session bootstrap (`operator_session_id`).
- All runs started in that session inherit the ID.
- Operator roll-ups = `GROUP BY operator_session_id` over telemetry + optional
  external operator CLI cost source (Claude `/cost`, opencode DB) linked by
  time overlap or explicit `operator_session_id` tag if the external tool
  allows — document as **export-time join**, not harness capture, until a
  concrete integration exists.

### 6. Harness facts vs operator judgment

Map from [outcome-data-source-audit.md](../../docs/outcome-data-source-audit.md):

| v1 outcome column | v2 capture stance |
| --- | --- |
| `cost`, token columns, `duration_minutes` (from phase times) | Harness-emitted; derived exports |
| `agent_count`, `session_type`, `failure_reason` (hint) | Harness-emitted from invocation rows |
| `files_touched`, `cost_per_file`, `cost_per_minute` | Harness-emitted at boundary or derivable in export |
| `report_date` | Harness-emitted from `run_start_ts` / first invocation `ts` |
| `completed_work_units`, `success_status`, `overall_success`, `notes` | Operator annotation layer (optional future `annotations` store or export columns) — **not** reconstructed from CSV |

Doc must state: v2 does not eliminate operator judgment; it eliminates
re-keying and re-deriving harness-known facts.

### 7. Storage and query posture

- **Format:** append-only JSONL default (matches v1 `runs.jsonl`, v2 log
  stream pattern; DuckDB `read_json_auto` friendly).
- **Location:** under `~/.jarvis/` (e.g. `telemetry.jsonl`), injectable path for
  tests — same pattern as log sink.
- **No harness query API in v1 of capture** — sink + optional tail for
  debugging; analysis is external.
- **Retention / rotation:** out of scope for reference doc beyond "single
  append-only file per machine; rotation is operator concern until a consumer
  needs otherwise."

### 8. CSV and markdown reports as derived exports

Reference doc should describe the target end state without specifying commands:

- `reports/session-costs.csv` grain ≈ one export row per `run_id` (or per
  spec phase grouping if workflow emits multiple runs per intent — doc should
  prefer 1:1 run:spec work unit).
- `reports/session-outcomes.csv` ≈ export joining telemetry facts + operator
  annotations.
- `reports/operator-*.csv` ≈ `operator_session_id` roll-up.
- `reports/efficiency.csv` ≈ pure derivative — never written by hand.
- Per-report markdown mirrors cost fields only (operator-runbook parity).

**No `notes` binding fields** in v2 export schema — bindings are redundant when
IDs exist.

### 9. Relationship to v1 `runs.jsonl`

Doc should include a field mapping table (v1 → v2) for planners migrating
mental models, not data:

| v1 `runs.jsonl` | v2 telemetry |
| --- | --- |
| `namespace` | replaced by `run_id` + `attempt_id` (+ optional `spec_ref`) |
| `mode` / `plan_phase` / `patch_phase` | `workflow` + `step_id` + `role` + optional `phase` |
| `record_role: run_terminal` | `record_kind: run_terminal` |
| `iteration` | `attempt_number` denormalized on invocation rows |
| per-invocation `usage` / `cost_usd` | same buckets on `invocation_completed` |

Explicit: **no backfill** — v1 file stays as historical archive; v2 emits
forward from first implementation slice.

### 10. Build-order placement (for implementers reading the doc)

Sequence guidance to pin:

| Phase | Capture milestone |
| --- | --- |
| **Now (pre-implementation)** | This reference doc only |
| **Phase 5** (workflow runner + config) | Minimal `invocation_completed` from shared step-runner for all bound invocations |
| **Phase 6** (review-debate + human) | Same schema for debate roles + actuator; no plan/patch fork |
| **Phase 8** (PR lifecycle) | `work_boundary_recorded` with `commit_sha` / `files_changed` |
| **Post-parity** | Export commands replacing manual CSV reconciliation; operator annotations optional |

Do not block TUI/daemon phases on telemetry; do not defer IDs-on-facts until
post-parity (that recreates v1 `notes` binding).

### 11. Testing contract (for future implementation specs)

Reference doc should note:

- Telemetry sink is injectable (temp path per test).
- Contract tests: emitted row contains expected IDs and required fields after
  injected invocation; no assertion on analysis roll-ups in harness tests.
- Golden-file optional for schema_version bumps only.

### 12. Naming collisions to resolve in plan

- Observability `boundary_committed` vs telemetry boundary record — use distinct
  `record_kind` / file / doc terms.
- `LogEvent` in `log-stream.ts` vs telemetry events — telemetry doc should call
  them **facts** or **telemetry records**, not "log events."
- `outcome_kind` exists in orchestration store — telemetry boundary rows may
  denormalize it; doc clarifies orchestration row is authoritative for resume,
  telemetry row is authoritative for analysis history.

## Suggested `telemetry-capture.md` outline

Plan should draft roughly this TOC:

1. Purpose and non-goals (no recovery, no analysis UI, no backfill)
2. Three-store model (table + diagram)
3. Event grains and ID join rules
4. Record kinds and JSON schema (`schema_version`, required/optional fields)
5. Emission boundaries (code seam pointers)
6. Cross-behavior coverage (write / review-debate / plan / human-paused runs)
7. Operator session and external operator cost (export-time join)
8. Harness facts vs operator judgment (audit mapping table)
9. v1 `runs.jsonl` and CSV reporting — legacy vs v2 export target
10. Build-order placement
11. Testing and injectability expectations
12. Open questions deferred to implementation specs (e.g. one row per quota
    fallback vs aggregated invocation, path list vs count-only at boundary)

## Documentation updates

- [ ] `v2/docs/telemetry-capture.md` — new durable home (primary deliverable).
- [ ] `v2/docs/v2-architecture.md` — Persistence / Observability: third-store
  paragraph + link.
- [ ] `v2/docs/v2-build-order.md` — cross-cutting telemetry bullet with phase
  milestones.
- [ ] `v2/docs/shared-step-runner.md` — link to telemetry doc at emission
  boundary note.
- [ ] `v2/docs/state-store.md` — explicit "telemetry stays out" cross-link.
- [ ] `v2/docs/outcome-data-source-audit.md` — forward link: "v2 capture
  contract" section or see-also.

## Prerequisites

- [v2-architecture.md](../../docs/v2-architecture.md) — persistence split and
  "token/cost streams stay out of orchestration store" decision landed.
- [state-store.md](../../docs/state-store.md) — current orchestration schema and
  API boundaries.
- [log-stream.ts](../../src/log-stream.ts) — observability event kinds (contrast
  only).
- [outcome-data-source-audit.md](../../docs/outcome-data-source-audit.md) —
  outcome column classifications.
- [v2-build-order.md](../../docs/v2-build-order.md) — phase numbering for
  sequencing section.
- [shared-step-runner.md](../../docs/shared-step-runner.md) and
  [shared-invocation.md](../../docs/shared-invocation.md) — invocation seam
  exists (emission not wired).
