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

- [x] The subspec defines a durable run record that owns identity, lifecycle
      status, resume checkpoint, and pointers to work artifacts, while keeping
      mutable execution history out of a single run blob.
- [x] The subspec decides the Phase 1 execution-history shape explicitly:
      `runs`, `step_attempts`, and `step_outcomes`, with outcome not left
      implicit inside a free-form attempt payload.
- [x] The subspec chooses stable identifiers for runs, workflow step linkage,
      and attempt ordering such that later resume reads and daemon APIs do not
      depend on array position or in-memory numbering.
- [x] The subspec defines one concrete durable checkpoint on the run in terms of
      stable workflow step identity, and keeps repeat-range position or other
      richer orchestration bookkeeping out unless required for that checkpoint.
- [x] The subspec names closed enum sets for at least run status, step kind,
      attempt terminal status, and outcome classification instead of leaving
      those semantics to free-form JSON.
- [x] The subspec makes the attempt/outcome split concrete by stating whether
      `step_outcomes` is a separate table keyed from `step_attempts` or a
      separately typed row shape with an equally explicit durable identity.
- [x] The durable payload for a completed attempt is kept narrow and
      deterministic: timestamps, terminal status, outcome classification, and
      only the selected fields later workflow logic must branch on, with raw
      transcripts, token/cost streams, and event bodies explicitly excluded.
- [x] The subspec explicitly defers transcript bodies, rich logs/events,
      daemon/session metadata, quota bookkeeping, and other later-phase fields
      rather than leaving their Phase 1 status ambiguous.

## Documentation updates

- Update `v2/docs/v2-architecture.md` so the run-state section names the
  Phase 1 `runs`/`step_attempts`/`step_outcomes` split, the checkpoint-on-run
  model, and the fact that work artifacts remain pointers rather than embedded
  work-state blobs.
