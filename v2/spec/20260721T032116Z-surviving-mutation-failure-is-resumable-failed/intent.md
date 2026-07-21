---
name: surviving-mutation-failure-is-resumable-failed
---

# Report surviving mutations as resumable failures

## Outcome

- A run that fails mutation verification settles `failed`, never `completed`.
- `run list`, `run wait`, the terminal log, and `run resume` agree that the run is resumable.
- Operator output names the surviving mutation's file and guard and directs the operator to resume after adding coverage.

## Decisions

- The final `surviving_mutation_failed` outcome owns the run's durable status; rules out retaining an earlier completion boundary's `completed` status.
- A surviving-mutation failure is `failed` and resumable with `retryable: true` and `nextAction: "resume"`; rules out terminal refusal that forces a fresh branch and loses review history.
- Persisted reporting forbids `completed` with `resumable: true`; rules out treating row status and terminal-log resumability as independent claims.
- Preserve mutation verification and its verdict; rules out weakening or bypassing the gate to recover a green status.

## Acceptance criteria

- [ ] A run ending `surviving_mutation_failed` settles `failed`; no list or wait result reports it `completed`.
- [ ] List and wait report `retryable: true`, `nextAction: "resume"`, and the surviving mutation's source file and guard.
- [ ] The terminal log reports the same resumability that `run resume` enforces, and resume accepts the failed row.
- [ ] No persisted terminal observation combines `runStatus: "completed"` with `resumable: true`.
- [ ] A regression covering finalization after an earlier completion boundary fails against the baseline and passes after the change.
- [ ] A genuine completion remains `completed`, non-resumable, and free of failure remediation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — completed-run trust and surviving-mutation recovery.
- `v2/docs/state-store.md` — terminal status/resumability invariant.
- `v2/docs/workflow-runner.md` — mutation-finalization settlement and resume behavior.
- `v2/docs/v1-behaviors.md` — changed v2 failure-reporting semantics.

## Prerequisites

- Implement completion runs mutation verification before the ready flip.
