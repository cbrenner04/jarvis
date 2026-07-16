---
name: distinguish-ready-gate-and-flip-failures
---

# Distinguish ready-gate and ready-flip failures

V2 completion publication collapses a red gate and a failed `gh pr ready` into
`ready_finalize_failed`. Logs and `run list` cannot tell whether code verification or GitHub
publication failed.

## Decisions

- Surface red gates as `ready_gate_failed` and failed draft-to-ready flips as `ready_flip_failed`; rules out retaining the overloaded `ready_finalize_failed` outcome.
- Carry the distinction through workflow results, `loop_finished`, `wait`, and `run list`; rules out separating only internal exception types while operator evidence stays ambiguous.
- Keep `completion_commit_failed` for commit, push, PR creation, and body refresh failures; rules out folding publication failures into either ready outcome.
- This slice classifies failures without changing repair or durable completion semantics; rules out debugging the dead repair path through the overloaded outcome.

## Scope

- Add regression coverage that independently drives gate, flip, and earlier publication failures through the workflow publication path.
- Preserve green gate followed by successful flip behavior.

## Documentation updates

- `v2/docs/workflow-runner.md` — distinct publication, gate, and flip outcomes.
- `v2/docs/daemon-host.md` — `list` and `wait` error reasons and resume eligibility.
- `v2/docs/v1-behaviors.md` — replace the overloaded v2 finalization outcome in the parity record.

## Prerequisites

- V2 completion publication runs the ready gate before the draft-to-ready flip.
