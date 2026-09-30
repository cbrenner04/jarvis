# Entry-complete missing durable row rollup

## Problem

`resolveWorkflowRunRollup` (`v2/src/persistence/workflow-run-status-rollup.ts`) returns `killed` for any authored durable step with no sibling run row in a non-live invocation. After `pipeline resume` reopens an implement stage, a fresh invocation can complete the entry `implement` row with `terminalCause: "complete"` without ever creating a row for a later durable successor (a no-op resume with `attemptCount` 0 whose successor already completed in an earlier invocation of the same lane). Rollup then reports `killed` while the entry row honestly completed.

## Decisions

- A missing durable successor row in a non-live invocation counts as satisfied only when all hold: (a) entry `status: "completed"` with strict `terminalCause === "complete"`; (b) entry `attemptCount === 0`; (c) the latest earlier invocation of the same lane (same project, branch, `specRef`; entry row created before this entry) that has a row for that successor `stepId` has it `completed`. Otherwise it stays `killed` — rules out relief on (a) alone, which masks a daemon death after the entry settled complete but before the successor row existed.
- Evidence (c) arrives as a new optional `RollupArgs` thunk of prior-lane runs, supplied by callers and invoked only after (a)+(b) hold and the row is missing; callers read it via an indexed project/branch/`specRef` store query; absent field means no prior evidence (`killed`) — rules out the rollup querying the store itself and eager per-row lane scans on `list`.
- Null/unset or non-complete `terminalCause` never qualifies (pre-migration rows keep `killed`).
- Live invocations return `in-progress` before the step loop (`workflow-run-status-rollup.ts` ~67), unchanged.
- Not step-id-specific: reopened implement without `implement-review` (rows e7b5a8ed, a53eed3c, 89763876) is the motivating instance — rules out a carve-out.
- Linked-implement partial routing (`linkedRoutingFinished`) and pipeline stage settlement stay unchanged.
- `v2/docs/workflow-runner.md` is the durable home for the rule; `v2/docs/pipeline-execution.md` stays unchanged.

## Tasks

- [x] Add optional prior-lane runs to `RollupArgs`; in the step loop, treat a missing durable row as satisfied only under (a)+(b)+(c), else return `killed`.
- [x] Supply prior-lane runs (same project, branch, `specRef`, earlier invocations) from the daemon `list`/`wait` rollup callers in `daemon-run-lifecycle-handlers.ts`.
- [x] Add unit tests in `workflow-run-status-rollup.test.ts` per acceptance criteria.
- [x] Update the `resolveWorkflowRunRollup` doc-comment.

## Acceptance criteria

- [x] Test: entry `completed`, `terminalCause: "complete"`, `attemptCount: 0`, no successor row, prior same-lane invocation has a `completed` successor row → rollup `completed`; fails against pre-fix `killed`.
- [x] Test: entry `completed`, `terminalCause: "complete"`, `attemptCount` ≥ 1, no successor row, no prior successor → `killed`.
- [x] Test: entry `completed`, `terminalCause: "complete"`, `attemptCount: 0`, no successor row, no prior successor → `killed`.
- [x] Test: entry with null or non-complete `terminalCause` and a missing successor stays `killed`.
- [x] Linked-implement describe block stays green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — non-live rollup: a missing durable row is satisfied only for a zero-attempt complete entry whose successor completed in an earlier same-lane invocation.
- `v2/docs/v1-behaviors.md` — align the daemon `wait`/`list` durable-step rollup bullet with the same rule.
