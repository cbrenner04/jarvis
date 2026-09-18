# No-row routing failure persists a real row before reporting its id

## Problem

`linkedImplementRoutingFailureOutcome` (`v2/src/execution/workflow-runner.ts`) mints `crypto.randomUUID()` when `existingRunId` is undefined (the pre-dispatch `resolveActiveLinkedSubspec` call site, reached on a linked-implement step's first dispatch and on every subsequent loop iteration that advances to the next link), reports it via `onStepRunCreated` without a row, and returns `complete` (`empty_index`/`already_complete`) or `blocked` (`link_unreadable`/`malformed_link`/`link_out_of_tree`) carrying that phantom id — `store.loadRun` on it is `null`, so nothing downstream can settle or query it.

## Decisions

- No `existingRunId`: create a real row via `store.createRun` instead of minting `crypto.randomUUID()`, for every routing `errorKind`; `onStepRunCreated` reports only that persisted id. Outcome `kind` per `errorKind` is unchanged (`complete` for `empty_index`/`already_complete`, `blocked` for the rest) — rules out turning `already_complete`/`empty_index` into `blocked`: `"skips appended patch review when linked index is already complete"` (`workflow-runner-debate.test.ts`) already drives a two-step workflow that needs the overall `complete` result to skip the review step and finish; a `blocked` result there would strand the workflow.
- `WorkflowResult.runId` stays a required `string`; no result-shape change and no changes to `commands/workflow.ts`, daemon admission handling, or pipeline stage resolution — they already consume a real per-kind id today, and after this fix the id genuinely is one. Rules out an id-less "refusal" outcome and the two-subspec (runner/caller) split: `daemon-workflow-admission-handlers.ts`'s admission promise resolves the client's response only from `onStepRunCreated` firing at `stepIndex === 0` (no other `resolve()` call on that path) — dropping the call for a linked-implement entry step (the common case: `implement` workflows start with one) would hang the daemon indefinitely, so the id must keep flowing, just backed by a real row instead of a phantom one.
- Reuses the existing `implement.<errorKind>: <message>` string as-is on `routingFailure`; no format or suffix change.
- `existingRunId` path (post-link `resolvePinnedLinkedSubspec`) unchanged: real id reused and settled — `"settles the real link row when routing fails after that link's write loop completed"` (`malformed_link`) stays green.
- Resume never reaches the no-row branch: `reconstructPausedWriteResumeInput` (`workflow-runner-resume.ts`) requires an existing persisted `run` row and calls `resolvePinnedLinkedSubspec` directly, never `resolveActiveLinkedSubspec` or this function's no-row branch.
- Multi-step workflows: unaffected. This only changes how the failing step's own row is created; earlier steps' rows are already durable, and `executeWorkflow` already stops at the first non-`complete` step.
- Deferred to first consumer: the initial `status` passed to `store.createRun` for the no-row row — pin whatever keeps the row out of a stuck `in-progress` state for both the `complete` and `blocked` outcomes; the acceptance criteria below pin the observable contract.

## Tasks

- [ ] In `linkedImplementRoutingFailureOutcome`'s no-`existingRunId` branch, replace the `crypto.randomUUID()` mint with a `store.createRun(...)` call (thread `store` and the step/worktree/workflow-snapshot fields it needs through from `runLinkedImplementStep`), keeping `onStepRunCreated` and the outcome `kind` per `errorKind` unchanged.
- [ ] Update `workflow-runner-debate.test.ts`'s `"returns a routing failure whose run id was never persisted without throwing"` test: rename it and invert its `store.loadRun(result.runId)` assertion to non-null now that the row is real.
- [ ] Extend `"skips appended patch review when linked index is already complete"` (or add a sibling `empty_index` test) with a `store.loadRun(result.runId)` non-null assertion.

## Acceptance criteria

- [ ] A runner test drives linked implement with an `already_complete` index and with an `empty_index` index and no existing row, asserting `result.kind === "complete"` and `store.loadRun(result.runId)` non-null; it fails against the pre-fix phantom id (`store.loadRun` returns `null`).
- [ ] A runner test records every id passed to `onStepRunCreated` across no-row routing failures (`empty_index`, `already_complete`, `link_unreadable`, `malformed_link`, `link_out_of_tree`), asserting `store.loadRun(id)` is non-null and its status is not `in-progress` for each; it fails against the pre-fix code.
- [ ] `"keeps chained routing and index ticks in the implement worktree"` (normal linked dispatch, ids already persisted) stays green.
- [ ] `"settles the real link row when routing fails after that link's write loop completed"` (`existingRunId` path, `malformed_link`) stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — admission persistence contract: every id reported via `onStepRunCreated`, including a no-dispatch linked-routing outcome, is backed by a persisted row before it's reported.
- `v2/docs/v1-behaviors.md` — record that no-dispatch linked routing's reported run id is now always persisted (outcome `kind` per `errorKind` unchanged).
