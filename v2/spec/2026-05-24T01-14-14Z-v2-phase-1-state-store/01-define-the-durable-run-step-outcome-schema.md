# 01 - Define the durable run-step-outcome schema

With bootstrap settled, Phase 1 needs the first durable model. This slice
defines the records, identifiers, closed enums, and narrow payload fields for
runs, step attempts, and outcomes. Its job is to make the orchestration-state
vs work-state split explicit and keep the schema biased toward later
single-step execution without dragging in daemon or observability concerns.

## Decisions

- Keep orchestration state on `runs`: identity, workflow pointers, lifecycle
  status, and the durable boundary checkpoint used for resume.
- Record execution history separately from runs. A step attempt is the durable
  execution record; an outcome is the durable classification and selected
  payload later workflow logic branches on.
- Use stable, explicit identifiers early: durable run IDs, stable step IDs from
  workflow source, and ordered attempt numbers or equivalent durable sequencing
  for per-step history.
- Prefer closed enums over open-ended JSON for run status, step kind, attempt
  status, and outcome classification.
- Keep work artifacts as pointers only: worktree path, branch, spec path, PR
  ref, or equivalent references. Do not persist repo contents, prompt bodies,
  transcript bodies, or live log streams here.
- Defer fields that belong to later phases: daemon pid/socket data, quota
  heuristics, structured log/event feeds, human steering prompts, repeat-range
  position beyond what the checkpoint requires, concurrency/admission state,
  and token/cost detail.

## Task Checklist

- Define the Phase 1 tables or equivalent durable records.
- Define the identifier strategy and ordering semantics for run and attempt
  history.
- Define the closed enum sets and the minimal payload fields each record owns.
- Document the explicit deferrals so later phases extend the model deliberately.

## Acceptance criteria

- [ ] The subspec defines a durable run record that owns identity, lifecycle
      status, resume checkpoint, and pointers to work artifacts, while keeping
      mutable execution history out of a single run blob.
- [ ] The subspec defines separate durable execution history for step attempts
      and makes explicit whether outcome is stored as its own table or as a
      distinct concept within the attempt record.
- [ ] The subspec chooses stable identifiers for runs, workflow step linkage,
      and attempt ordering such that later resume reads and daemon APIs do not
      depend on array position or in-memory numbering.
- [ ] The subspec names closed enum sets for at least run status, step kind,
      attempt terminal status, and outcome classification instead of leaving
      those semantics to free-form JSON.
- [ ] The durable payload for a completed attempt is kept narrow and
      deterministic: timestamps, terminal status, outcome classification, and
      only the selected fields later workflow logic must branch on.
- [ ] The subspec explicitly defers transcript bodies, rich logs/events,
      daemon/session metadata, quota bookkeeping, and other later-phase fields
      rather than leaving their Phase 1 status ambiguous.

## Documentation updates

- Update `v2/docs/v2-architecture.md` so the run-state section names the
  Phase 1 run/attempt/outcome split and the fact that work artifacts remain
  pointers, not embedded work-state blobs.
