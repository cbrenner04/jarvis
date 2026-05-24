# 01 - Define the durable run-step-outcome schema

With bootstrap settled, Phase 1 needs the first durable model. This slice
defines the records, identifiers, closed enums, and narrow payload fields for
`runs`, `step_attempts`, and `step_outcomes`. Its job is to make the
orchestration-state vs work-state split explicit and bias the store toward a
later single-step runner without pulling in daemon or observability concerns.

## Decisions

- Keep orchestration state on `runs`: identity, workflow pointers, lifecycle
  status, terminal summary, and the durable checkpoint used for resume.
- Record execution history separately from runs. A step attempt is the durable
  execution record; an outcome is the durable classification and selected
  payload later workflow logic branches on.
- Use stable identifiers early: durable run IDs, stable workflow step IDs, and
  durable attempt numbering or an equivalent per-step history key.
- Keep the run checkpoint minimal: it names the next durable step boundary to
  execute rather than storing mutable in-progress state.
- Prefer closed enums over JSON blobs for run status, step kind, attempt
  status, and outcome classification.
- Keep work artifacts as pointers only: worktree path, branch, spec path, PR
  ref, or equivalent references.
- Defer daemon/session metadata, quota heuristics, transcript bodies, log/event
  streams, human steering detail, concurrency state, and token/cost detail.

## Phase 1 durable model

### `runs`

- Identity: `run_id` (durable string ID), `project_key`, `workflow_id`,
  `target_ref`, `created_at`.
- Lifecycle: `run_status` enum (`running`, `paused`, `awaiting_human`,
  `blocked`, `completed`, `killed`, `failed`), `started_at`, `ended_at`.
- Durable checkpoint: `next_step_id` (stable workflow step ID or `null` when
  terminal). This is the only Phase 1 resume checkpoint field on `runs`.
- Work pointers only: `worktree_path`, `branch_name`, `spec_path`, `pr_ref`
  (all nullable pointers, never embedded artifacts).
- Terminal summary fields: `terminal_outcome_class` (`success`, `blocked`,
  `killed`, `failed`) and `terminal_reason` (short text, nullable).

### `step_attempts`

- One row per durable attempt of a workflow step for a run.
- Identity and linkage: `attempt_id` (durable string ID), `run_id`,
  `step_id` (stable workflow step ID), `attempt_ordinal` (1-based integer per
  `run_id + step_id`, monotonic and unique).
- Step kind enum: `step_kind` (`implementation`, `review`, `human`).
- Attempt terminal status enum: `attempt_status`
  (`succeeded`, `blocked`, `killed`, `failed`).
- Deterministic timestamps only: `started_at`, `ended_at`.

### `step_outcomes`

- Separate table keyed from `step_attempts` (not a free-form JSON column on
  attempts).
- Identity and linkage: `outcome_id` (durable string ID), `attempt_id`
  (unique foreign key to `step_attempts`), `run_id`, `step_id`.
- Outcome classification enum: `outcome_class`
  (`progress`, `done`, `no_work`, `blocked`, `error`).
- Narrow branch payload fields only: `blocker_reason` (nullable short text),
  `repeat_from_step_id` (nullable stable step ID), `repeat_to_step_id`
  (nullable stable step ID).
- Deterministic timestamp: `recorded_at`.

### Explicit Phase 1 deferrals

- Excluded from Phase 1 durable payloads: transcript bodies, prompt/response
  event streams, token/cost streams, daemon session metadata, quota counters,
  rich logs, and concurrency bookkeeping.
- If later phases need those fields, add forward-only migrations after this
  Phase 1 schema lands.

## Task Checklist

- Define the Phase 1 records.
- Define the identifier strategy and ordering semantics.
- Define the run checkpoint fields and workflow-step linkage.
- Define the closed enums and minimal payload fields.
- Document the explicit deferrals.

## Acceptance criteria

- [ ] A forward-only migration creates `runs`, `step_attempts`, and
      `step_outcomes` with the columns named in "Phase 1 durable model"; a test
      asserts the three tables and their key columns exist after bootstrap.
- [ ] Closed TypeScript unions are exported for `run_status`, `step_kind`,
      `attempt_status`, and `outcome_class` matching the schema; a test (or
      typecheck) rejects values outside those sets.
- [ ] `runs` carries exactly one resume checkpoint column (`next_step_id`,
      nullable) and stores work artifacts as nullable pointer columns only; a
      test round-trips a created run's checkpoint and pointer fields.
- [ ] `step_attempts.attempt_ordinal` is unique and monotonic per
      `(run_id, step_id)`, and `step_outcomes` links one-to-one from
      `attempt_id`; tests assert the uniqueness constraint and the linkage.
- [ ] Deferred fields (transcripts, token/cost, event streams, daemon/session
      metadata, quota) are absent from the Phase 1 schema.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v2/docs/v2-architecture.md` so the run-state section names the
  Phase 1 `runs`/`step_attempts`/`step_outcomes` split, the checkpoint-on-run
  model, and the fact that work artifacts remain pointers rather than embedded
  work-state blobs.
