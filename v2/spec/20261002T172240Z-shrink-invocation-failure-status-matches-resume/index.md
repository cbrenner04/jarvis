# Post-commit shrink invocation failure matches resume admission

repo: cbrenner04/jarvis

Post-commit `implement~shrink` `invocation_failure` with `failureKind: "error"` settles `paused` without a corrective terminal `loop_finished`, and `composeRunOperatorErrorFromState` maps `terminalCause: "invocation_failure"` through `mapInvocationFailureDetail` before a resumable shrink-row `loop_finished` can advertise resume — list/wait and `jarvis run resume` refuse while the row stays `paused`.

- [x] [00 - Corrective loop_finished for post-commit shrink invocation error](./00-post-commit-shrink-invocation-error-loop-finished.md)

## Prerequisites

- The completed implement write output is committed before the hidden shrink pass runs.
- Post-commit shrink `contract_miss` already appends corrective `loop_finished` with `resumable: true` in `settlePostCommitShrinkForResume` and `run-operator-error.test.ts` `post-commit shrink contract_miss composes to resume` pins resume composition for that durable row shape; post-commit shrink `invocation_failure` with `failureKind: "error"` has neither the corrective log nor equivalent composer precedence on main.

## Out of scope

Quota, `model_config`, `no_binding`, and shrink `invocation_failure` kinds other than post-commit `failureKind: "error"`; shrink `blocked` with persisted blocker text; implement-step (non-shrink) outcomes.
