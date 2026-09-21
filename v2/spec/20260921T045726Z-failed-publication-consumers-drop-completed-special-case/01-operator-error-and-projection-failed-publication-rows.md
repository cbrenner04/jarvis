# Operator error and list/wait projection ignore stale publication causes on completed rows

`run-operator-error.ts` maps a durable `terminalCause` and `loop_finished` records to publication errors regardless of row status, and `daemon-run-lifecycle-handlers.ts` projects `loopOutcomeKind` from `run.terminalCause` on any row, which `run-completion.ts` turns into a failure exit. After migration `032` a `completed` row carrying `completion_commit_failed` or `ready_flip_failed` is stale evidence.

## Decisions

- Removal is scoped to `completion_commit_failed` and `ready_flip_failed`; a `completed` row is successful for projection even when stale evidence names one of them — rules out broadening to `ready_gate_failed`, which migration `032` does not rewrite.
- `ready_gate_failed` on a completed row keeps its current mapping, pinned by `run-operator-error.test.ts` "composeRunOperatorError maps ready gate, surviving mutation, and flip failures from loop_finished" — rules out dropping it with the other two.
- Daemon lifecycle projection and operator-error composition own the classification; `run-completion.ts` only renders the daemon result — rules out a second cause classifier in the CLI.
- A trailing `run_execution_failed` still surfaces on a `completed` row and wins over a stale publication cause — rules out suppressing every completed-row diagnostic.
- A stale publication cause on a completed row is dropped from `error` and from the `loopOutcomeKind` that drives the exit code.

## Tasks

- [ ] Update `v2/src/daemon/run-operator-error.ts` so durable terminal causes and `loop_finished` records for the two publication causes do not turn a `completed` row into a publication failure; preserve trailing `run_execution_failed` and `ready_gate_failed` handling.
- [ ] Update `v2/src/daemon/daemon-run-lifecycle-handlers.ts` so list/wait projection does not carry those stale causes as `loopOutcomeKind` on a `completed` row.
- [ ] Update `v2/src/daemon/run-operator-error.test.ts` cause-precedence coverage to use `failed` publication rows, with a `ready_flip_failed` case beside each `completion_commit_failed` case, and reject the completed-row compatibility case.
- [ ] Add `v2/src/daemon/daemon-wait-run-completion.test.ts` coverage for failed publication rows and a completed-row control across list and wait projection.
- [ ] Add a CLI projection test (`v2/src/cli/run-completion.test.ts`) driving `waitForRunCompletion` against the daemon wait result for a completed row with a stale publication cause.

## Acceptance criteria

- [ ] `run-operator-error.test.ts` proves a failed `completion_commit_failed` row composes retryable resume guidance and a completed row with the same stale cause does not; the completed-row assertion fails against the pre-fix code.
- [ ] `run-operator-error.test.ts` proves the same for `ready_flip_failed` (failed row composes the non-retryable stop error; completed row with the stale cause composes none).
- [ ] `run-operator-error.test.ts` proves a completed row with a stale `completion_commit_failed` cause plus a later `run_execution_failed` still composes the `run_execution_failed` error and no publication error; fails against the pre-fix code.
- [ ] `run-operator-error.test.ts` "composeRunOperatorError maps ready gate, surviving mutation, and flip failures from loop_finished" stays green (completed `ready_gate_failed` unchanged).
- [ ] `daemon-wait-run-completion.test.ts` proves list and wait report a failed `completion_commit_failed` row as failed and resumable, and a failed `ready_flip_failed` row as failed and not resumable, while a completed row with either stale cause reports no `error` and no failure `loopOutcomeKind`; the completed-row control fails against the pre-fix projection.
- [ ] `run-completion.test.ts` proves a completed row with a stale publication cause renders a success payload and exit code 0 through `waitForRunCompletion`, and a failed `completion_commit_failed` row renders a failure exit; the completed-row assertion fails against the pre-fix code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — reconcile the operator-error projection entries (`run-operator-error.ts`, `run-completion.ts` list/wait) with the failed-row invariant; remove completed-with-failure-cause compatibility wording while retaining completed `ready_gate_failed`, completed review-row recovery, and trailing `run_execution_failed` semantics.
- `v2/docs/first-workflow-walkthrough.md` — the missing-`gh`/`origin` note (near "Finding the branch and PR") says the run reaches `completed` locally with a `completion_commit_failed` operator error; state that publication failure settles the run `failed` with a retryable `completion_commit_failed` error.
