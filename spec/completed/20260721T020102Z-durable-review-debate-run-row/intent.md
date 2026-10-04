---
name: durable-review-debate-run-row
---

# Persist review-debate workflow steps as run rows

## Outcome

- Every reached `review-debate` step owns a durable run row whose lifecycle follows the step outcome.
- `jarvis run list` and `jarvis tui` retain the debate step and its terminal status after the workflow is no longer live.
- A plan workflow with debate review exposes the review as a separate durable row while preserving live role progress.

## Decisions

- Persist one row per `review-debate` step, not one row per debate role; roles are progress within one authored step.
- Apply the row contract to `review-debate` dispatch in the shared workflow runner, not only the plan preset; preset-specific durability would make identical steps observably inconsistent.
- Keep live role progress on the step snapshot while the durable row owns lifecycle status; rules out replacing current adversary/advocate/adjudicator/actuator visibility with a coarse in-progress row.
- Map a successful review to `completed`, a failed review to `failed`, and daemon-reconciled interruption to `interrupted`; neither non-success outcome is completed.
- Deferred to first consumer: mid-cycle review-debate resume and replay semantics — pin when a caller needs it.

## Acceptance criteria

- [ ] A plan workflow with debate review creates distinct durable rows for its draft and review steps, and list/TUI observations identify the review row by its authored step.
- [ ] The review row is `in-progress` during debate, `completed` after successful review, `failed` after failed review, and `interrupted` after daemon-reconciled interruption.
- [ ] After daemon restart, the review row remains queryable and an interrupted row is reconciled without being reported as completed.
- [ ] Existing live debate-role progress remains visible while the review row is active.
- [ ] Coverage exercises shared `review-debate` dispatch so other presets receive the same row behavior without preset-specific wiring.

## Documentation updates

- `v2/docs/workflow-runner.md` — durable review-debate identity, lifecycle, and deferred resume boundary.
- `v2/docs/state-store.md` — review-debate run-row semantics.
- `v2/docs/operator-runbook.md` — list/TUI visibility for debate review rows.
- `v2/docs/v1-behaviors.md` — record the changed v2 workflow observability behavior.

## Prerequisites

- Workflow snapshots and daemon list/TUI views expose authored `review-debate` steps with live debate-role progress.
- The state store supports workflow-scoped run rows keyed by project, branch, and step ID.
