# 01 - Daemon reports the rollup on wait and list

## Problem

`waitHandler` (`v2/src/daemon/daemon.ts`) returns as soon as the *subscribed run id* records a
`loop_finished`/`run_execution_failed` event, and returns immediately when that row's status is
not `in-progress`. For a workflow, both fire when step 0's write loop ends — 30s before the
review step's critic is even invoked. `list` shows the same premature `completed`.

Wire the rollup from `00` into these reads so the returned id's terminal status implies every
step is terminal.

## Decisions

- Do not change execution topology: `review` keeps running in its own run row after the write step's row completes. Rules out awaiting the review inside step 0's run (that reintroduces daemon blocking on a long agent invocation, `responsive-daemon-run-git` class).
- `wait` on a workflow entry run id awaits the daemon's in-flight `executeWorkflow` promise (tracked by entry run id), then returns the rollup — instead of terminating on a log record. Rules out log-driven termination: log records are per-row and the review row emits none today (`review-step-emits-log-events`, out of scope).
- `wait` on an entry id whose workflow is not live returns the rollup immediately (`completed`/`failed`/`blocked`/`awaiting-human`/`killed`), so a post-restart caller resolves rather than hangs.
- `wait` on a non-workflow run keeps the existing log-driven path untouched.
- The stopping step's terminal log record still supplies `loopOutcomeKind`/`iterationsConsumed`/`resumable`/`error` on the wait result; when the stopping step emits no record, the wait result carries the rollup status alone.

## Acceptance criteria

- [x] `wait` on the run id returned by a two-step (`write` then `review`) workflow does not resolve when the write step's loop finishes; it resolves only once the review step is terminal, reporting the review step's outcome.
- [x] A workflow that stops early (`blocked`, `contract_miss`, `invocation_failure`, `awaiting-human`, soft-stop) resolves `wait` on the returned id with that stopping outcome at that step, not `completed`.
- [x] `wait` on a returned id whose workflow is no longer live and whose later step never ran resolves `killed` instead of hanging.
- [x] Daemon `list` reports the rollup status for the entry row of a workflow invocation; other step rows report their own durable status.
- [x] Single-step and patch-run behavior is unchanged: `daemon-wait-run-completion.test.ts` and `daemon-workflow-async-failure.test.ts` stay green.
- [x] A regression test drives the observed defect: an `intent-reviewed`-shaped workflow whose review step lands after the write step returns `completed` from `wait` only after the review step's row is terminal.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — the returned run id's status covers every step of the invocation, including a trailing `review`.
- `v2/docs/daemon-host.md` — `wait`/`list` semantics for a workflow entry run id (rollup, not step 0's row).
