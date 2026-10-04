# Corrective `loop_finished` for post-commit shrink invocation error

## Primary implementation surface

- `v2/src/execution/workflow-runner.ts` (`settlePostCommitShrinkForResume` / `isPostCommitShrinkResumableOutcome`)
- `v2/src/daemon/run-operator-error.ts` (`composeRunOperatorErrorFromState` / resume composition for post-commit shrink `invocation_failure` with `failureKind: "error"`)

## Problem

`isPostCommitShrinkResumableOutcome` treats post-commit shrink `invocation_failure` with `failureKind: "error"` like `contract_miss`, but `settlePostCommitShrinkForResume` appends a corrective `loop_finished` with `resumable: true` only for `contract_miss` and `blocked`. Even with that append, `composeRunOperatorErrorFromState` returns early for `terminalCause: "invocation_failure"` via `mapInvocationFailureDetail` (`run-operator-error.test.ts` `post-commit shrink contract_miss composes to resume` shows the `contract_miss` path does not share that block), so operator error stays `invocation_error` / `stop` and `resolveRunResumeAdmission` refuses while durable status is `paused`. Latent since #2213; observed run `3dd4be83` (2026-10-02).

## Decisions

- Append the same corrective `loop_finished resumable: true` for post-commit shrink `invocation_failure` with `failureKind: "error"` as for post-commit `contract_miss` and text-less `blocked` in `settlePostCommitShrinkForResume` — rules out fixing only workflow `resumable` without aligning the terminal log, and rules out terminal `failed` instead of resumable `paused`.
- Align operator-error composition so `paused` shrink rows with `terminalCause: "invocation_failure"`, persisted `terminalFailureDetail` `failureKind: "error"`, and chronologically last shrink-row `loop_finished` `invocation_failure` `resumable: true` compose `nextAction: "resume"` like post-commit shrink `contract_miss` — rules out append-only settle leaving admission refused.
- Reuse the existing post-commit shrink resumability predicate (`isPostCommitShrinkResumableOutcome` or equivalent shared condition) when deciding to append — rules out duplicating divergent outcome lists in settle vs classify.
- Quota, `model_config`, `no_binding`, and other shrink `invocation_failure` failure kinds keep today's classifications — rules out broad shrink invocation reclassification.

## Task checklist

- Extend `settlePostCommitShrinkForResume` in `v2/src/execution/workflow-runner.ts` so post-commit shrink `invocation_failure` with `failureKind: "error"` appends corrective `loop_finished` with `loopOutcomeKind: "invocation_failure"` and `resumable: true` (mirror `contract_miss` / text-less `blocked`).
- Change `composeRunOperatorErrorFromState` in `v2/src/daemon/run-operator-error.ts` (or shared precedence it uses) so post-commit shrink `invocation_failure` `failureKind: "error"` with a resumable terminal shrink-row `loop_finished` composes to resume the way post-commit shrink `contract_miss` does.
- Add `workflow-runner-core.test.ts` `post-commit shrink invocation_failure error is resumable` mirroring `post-commit shrink contract_miss is resumable`: `executeWorkflow` through implement→commit→shrink `invocation_failure` (`failureKind: "error"`), durable `implement~shrink` row and chronologically last shrink-row `loop_finished` as `jarvis run resume` selects, then `resolveRunResumeAdmission` admitted (never `paused` with admission refused).
- Add `run-operator-error.test.ts` `post-commit shrink invocation_failure error composes to resume` mirroring `post-commit shrink contract_miss composes to resume` for `paused` + `terminalCause: "invocation_failure"` + `failureKind: "error"` + resumable terminal `loop_finished`.
- Do not change write-loop shrink settle semantics for non-resumable failure kinds or shrink `blocked` with blocker text.

## Acceptance criteria

- [x] `workflow-runner-core.test.ts` `post-commit shrink invocation_failure error is resumable` drives implement→commit→shrink `invocation_failure` with `failureKind: "error"`, asserts `implement~shrink` `paused`, chronologically last shrink-row `loop_finished` with `loopOutcomeKind: "invocation_failure"` and `resumable: true`, and `resolveRunResumeAdmission` admitted on the durable shrink row and terminal log tail `jarvis run resume` uses; never `paused` with admission refused; fails on main for that stranded symptom and stays RED under append-only settle until operator-error composition also advertises resume.
- [x] `run-operator-error.test.ts` `post-commit shrink invocation_failure error composes to resume` asserts `retryable: true` and `nextAction: "resume"` for `paused` with `terminalCause: "invocation_failure"`, `failureKind: "error"`, and resumable shrink-row `loop_finished`; fails on main (`composeRunOperatorErrorFromState` maps through `mapInvocationFailureDetail` before the resumable log wins).
- [x] `workflow-runner-core.test.ts` `resumes a shrink invocation error without re-invoking implement and publishes after shrink completes` stays green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Publication / completion failures: extend the post-commit shrink `contract_miss` resume bullet with the same `jarvis run resume` on `implement~shrink` for post-commit shrink `invocation_failure` (`failureKind: "error"`).
- `v2/docs/workflow-runner.md`: extend the corrective `loop_finished` sentence to include post-commit shrink `invocation_failure` (`failureKind: "error"`) alongside `contract_miss` and text-less `blocked`; do not restate general shrink error resumability already claimed there.
- `v2/docs/v1-behaviors.md`: record that shrink `invocation_error` after a committed implement write matches list/wait/resume admission (no stranded `paused` + refused resume).
