# Telemetry capture

Durable contract for **analysis facts** in v2: where they live, how they are
emitted, which IDs join them across stores, and what stays operator judgment.
This doc is the reference planners and implementers use so harness-known data is never
re-keyed through v1-style CSV `notes` bindings (`plan_ns`, `patch_ns`,
`git_fallback`).

**Non-goals for this doc:** runtime code, backfill, export commands, analysis
UI, v1 harness changes, or extending the orchestration SQLite schema with
token/cost columns.

## Three-store model

| Store | Default path | Role | Recovery? | Consumer |
| --- | --- | --- | --- | --- |
| **Orchestration** | `~/.jarvis/state/v2.sqlite` | Run lifecycle, attempt outcomes, checkpoint | **Yes** — resume derives from here + git | Write loop, workflow runner, daemon `wait` |
| **Observability** | injectable (shared `logs.jsonl`) | Loop lifecycle for tail/follow | **No** | TUI log follow, daemon IPC tail |
| **Telemetry** | `~/.jarvis/telemetry.jsonl` (injectable) | Append-only analysis facts | **No** | Future export, offline analysis |

Rules:

- **Recovery** reads orchestration store + git worktree only — never telemetry
  or the observability log ([`v2-architecture.md`](v2-architecture.md)
  Recovery).
- **Observability** events (`iteration_started`, `boundary_committed`,
  `loop_finished`, …) are for live visibility — not a substitute for per-invocation
  usage/cost ([`log-stream.ts`](../src/persistence/log-stream.ts)).
- **Telemetry** carries token/cost/usage and work facts — never orchestration
  checkpoint rows ([`state-store.md`](state-store.md)).

```text
orchestration (v2.sqlite)  →  resume / checkpoint
observability (logs.jsonl) →  tail / follow loop events
telemetry (telemetry.jsonl)→  append-only facts for analysis
```

## Event grains and join keys

| Grain | ID | When assigned |
| --- | --- | --- |
| Operator session | `operator_session_id` | CLI/daemon session bootstrap or first `start` |
| Run | `run_id` | `createRun` |
| Attempt | `attempt_id` | `recordAttemptStart` |
| Invocation | `invocation_id` | Each agent subprocess through the binding chain |

v1 `(report, name)` and `(report, session)` keys are **export labels**, not
harness join keys. Facts carry `run_id` / `attempt_id` / `invocation_id` at
emission. Optional denormalized `report_label` or `spec_display_name` may
appear for CSV export compatibility — never as the primary key.

## Record kinds

One JSON object per JSONL line. Top-level envelope on every record:

- `schema_version`: `1`
- `record_kind`: see below
- `ts`: ISO-8601 emission time

### `invocation_completed`

Emitted after each agent subprocess settles (shared invocation seam). Live
runtime coverage today is **write-step invocations only**; other shared
invocation callers stay no-op until they pass both write-step context and a
telemetry sink. Required context: `operator_session_id`, `run_id`,
`attempt_id`, `invocation_id`, `project`, `workflow`, `step_id`, `role`,
`agent`, `model`, `binding_index`, `duration_ms`, `worktree_path`, `branch`,
`spec_ref`.

Quota fallback grain is pinned: emit **one row per binding subprocess in
attempt order**, not one aggregate row for the logical invocation. `run_id`,
`attempt_id`, `workflow`, `step_id`, `role`, `worktree_path`, `branch`, and
`spec_ref` stay shared across the fallback chain; `invocation_id` is distinct
per subprocess row and is passed in by the write-step caller.

Usage and cost — **emit keys with explicit `null` when unavailable** (do not
omit keys):

- `usage`: `{ input_tokens, output_tokens, cache_read_input_tokens,
  cache_creation_input_tokens }` — each `number | null`
- `usage_source`: `"agent" | "estimated" | "unavailable" | null`
- `cost_usd`: `number | null`
- `cost_source`: `"computed" | "estimated" | "unavailable" | null`
- `exit_kind`, `exit_reason`

Append failure rule: if the JSONL sink append fails after a subprocess settles,
the write step keeps the underlying invocation result and fallback behavior,
and surfaces the append failure separately on the invocation result. Later
runner classification (`contract_miss`, `invalid_token`, etc.) does not suppress
the already-settled row.

A step whose first response carries no terminal token triggers the runner's
one token-only re-prompt (`write.token-reprompt`); the re-prompt runs through
the same `executeWithQuotaFallback` seam and emits its own `invocation_completed`
row(s) — one per binding attempted, keyed by a fresh `invocation_id` per
binding (same length/order as `bindings`, distinct from the step's own IDs).
The step's `attempt_id`, `run_id`, and other context are shared with the
re-prompt rows. The re-prompt's cost/usage is **not** folded into the attempt
record's binding attempts (`StepRunResult.invocation.attempts`, derived from
the step's own — not the re-prompt's — invocation); it is visible only in
telemetry (its own rows) and in the write-loop run log (`token_reprompt`
event). A re-prompt binding never becomes the run's `completionAgent`.

Same shape for write, review-debate, and plan steps — only `workflow`, `step_id`,
`role`, and optional `phase` differ. No patch-only fork.

### `work_boundary_recorded`

**Implemented** at the write-loop / workflow-runner completion boundary (outside
`commitCompletionBoundary` and orchestration SQLite). Distinct from
observability `boundary_committed` — different consumer, different file, different
name. Required: `run_id`, `attempt_id`, `outcome_kind`, `run_status`,
`commit_sha`, `files_changed` (integer count of paths differing between the
completion commit's base tree and completion tree; name-only diff with rename
detection off — no path list in schema version 1).

Emission is gated on an attached telemetry block; the sink path is the injected
`sinkPath` when supplied, otherwise `~/.jarvis/telemetry.jsonl`. Append is
**at-least-once** (best-effort): a crash before publish may drop a row; a crash
after emit may duplicate one. An append failure is surfaced separately on the
returned result and does not alter boundary control flow or orchestration state.

Orchestration `outcome_kind` on the attempt row is authoritative for resume;
telemetry rows are authoritative for analysis history.

### `run_terminal`

Run-level summary when the loop or runner settles. Mirrors v1
`record_role: "run_terminal"` — exit summary without double-counting invocation
usage in roll-ups. Required: `run_id`, `loop_outcome_kind` or terminal
`run_status`, `iterations_consumed` when applicable.

## Emission boundaries

| Record kind | Code seam | Notes |
| --- | --- | --- |
| `invocation_completed` | `shared/invocation/execute.ts` | Runner passes full ID context in; emitter does not re-parse logs |
| `work_boundary_recorded` | Write loop / workflow runner at completion commit publish | Git facts from harness commit, not agent; gated on attached telemetry block |
| `run_terminal` | Loop finish / run failure path | One row per terminal run edge |

[`shared-step-runner.md`](shared-step-runner.md) owns token parsing and contract
dispatch; telemetry emission sits **below** the runner at the invocation layer
and **above** git at the boundary layer — not in the orchestration store API.

Observability `boundary_committed` ≠ telemetry `work_boundary_recorded`. Do not
alias event kinds across stores.

## Operator session

`operator_session_id` tags all runs started in one operator sitting. Operator
roll-ups (`operator-costs`, `operator-outcomes` grain) are
`GROUP BY operator_session_id` over telemetry — not a separate manual CSV row
the harness does not know about.

The CLI bootstrap point is implemented: `v2/src/cli.ts` `main()` mints one id
per process invocation and tags the direct (non-daemon) `write` path unless
the caller already supplied `telemetry`.

The daemon bootstrap point is also implemented: `v2/src/daemon/daemon.ts`
`startDaemon` mints one id per daemon process lifetime and applies it, via
`writeLoopExecutor`, to every `executeWriteLoop` call the daemon makes for
that process — one id shared across all runs and IPC-dispatched requests the
daemon serves, not per run or per request. Unlike the CLI bootstrap, the
daemon's id always wins: it overrides any `operatorSessionId` already present
on caller-supplied `telemetry` (override-wins precedence), since the daemon,
not the requesting client, is the operator-sitting boundary for daemon-managed
runs.

External operator CLI cost (Claude `/cost`, opencode SQLite) joins at **export
time** by time overlap or explicit session tag until a concrete integration
exists. That join is not a capture-path requirement for v2 telemetry v1.

## Harness facts vs operator judgment

Classification (the retired outcome-data-source audit folds into this
summary):

| Category | v2 stance |
| --- | --- |
| Cost, tokens, duration, `agent_count`, `session_type`, failure hints, `files_touched` | Harness-emitted or derivable from telemetry |
| `success_status`, `overall_success`, `completed_work_units`, free-form `notes` | Operator **annotation** layer — optional future export columns, not reconstructed from facts |

v2 eliminates re-keying harness-known fields; it does not eliminate operator
judgment.

## v1 legacy

| v1 | v2 |
| --- | --- |
| `~/.jarvis/runs.jsonl` per-invocation rows | `invocation_completed` in `telemetry.jsonl` |
| `namespace` | `run_id` + `attempt_id` + `spec_ref` |
| `mode` / `plan_phase` / `patch_phase` | `workflow` + `step_id` + `role` (+ optional `phase`) |
| `record_role: run_terminal` | `record_kind: run_terminal` |
| `reports/*.csv` + `notes` bindings | **Derived exports** keyed by stable IDs — no `plan_ns` / `patch_ns` / `git_fallback` in v2 export schema |

**No backfill.** v1 files remain historical archives; v2 emits forward from the
first implementation slice.

## Placement

Shipped: the shared per-step telemetry context (`operatorSessionId`,
`workflow`, `sinkPath`) passed identically to `write` and review steps, and
`work_boundary_recorded` with `commit_sha` / `files_changed`. Remaining:
export commands replacing manual CSV reconciliation. Do not block TUI/daemon
on telemetry; wire each seam behind its first consumer — not ahead of it.

## Testing contract

- Telemetry sink path is injectable (temp file per test).
- Contract tests assert required IDs and fields after a mocked invocation; no
  harness roll-up assertions in unit tests.
- `schema_version` bumps get golden-file or fixture checks only when the envelope
  changes.

No new tests ship with this doc-only deliverable.

## Related docs

- [`v2-architecture.md`](v2-architecture.md) — persistence split
- [`state-store.md`](state-store.md) — what stays out of SQLite
- [`log-stream.ts`](../src/persistence/log-stream.ts) — observability events (contrast)
- [`shared-invocation.md`](shared-invocation.md) — invocation seam
