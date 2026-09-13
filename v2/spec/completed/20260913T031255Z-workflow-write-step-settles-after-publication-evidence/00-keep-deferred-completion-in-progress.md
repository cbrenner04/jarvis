# Keep deferred completion in progress

## Problem

Workflow dispatch sets `publishCompletion: false` because publication belongs to the workflow tail, but the write-loop boundary currently interprets that flag as permission to settle the durable row `completed`. This exposes a terminal row before PR evidence or a named terminal cause exists.

A workflow can dispatch several write-loop rows for one logical write step: the step's own row, its hidden `~shrink` row when shrink runs, and one row per linked-index pass for `implement`. Only one of these — the row `executeWorkflow` already resolves as "the completion row" (the hidden shrink row when one exists, else the step's own row; `v2/docs/workflow-runner.md` § Completion publication failures) — is the row the publication tail settles with PR evidence or a terminal cause. Deferring every `publishCompletion: false` row indiscriminately would strand every other row (a completed implement write superseded by its own shrink pass, a completed non-terminal linked-index pass superseded by the next link) in `in-progress` forever, since nothing else ever settles them. A step whose `publishCompletion` is `false` because no publication is ever intended (e.g. `git: false`) has no owning tail at all, so deferring it would strand it the same way.

## Decisions

- Only the row `executeWorkflow` resolves as the workflow's completion row defers (`in-progress`, no `prNumber`/`prUrl`/`terminalCause`) on a `complete` write-loop outcome — rules out deferring every `publishCompletion: false` dispatch, which would strand a superseded implement-before-shrink row or a superseded non-terminal linked-index pass with no owner left to settle them.
- A write step's own row settling `completed` immediately when superseded by its own shrink pass, and a non-terminal linked-index pass settling `completed` immediately when superseded by the next link, are unchanged from today — rules out disturbing the documented "resume skips the completed implement write" contract (`v2/docs/workflow-runner.md` § Execution contract) that resume already relies on.
- A step whose `publishCompletion` is `false` with no owning workflow tail (e.g. `git: false`, no later publication attempt) keeps settling `completed` at its own boundary immediately, exactly as today — rules out generic `publishCompletion: false` permanently stranding a row that no tail will ever settle.
- `settleNonCompleteWorkflowStep`'s eligibility widens from rows currently `completed` to also cover rows the write loop left deferred `in-progress` — a post-loop `contract_miss`/`blocked` outcome (e.g. `finalizeLinkedImplementPass` invalidating a linked pass's write-loop `complete` after the fact) must still correct a deferred completion row the same way it already corrects an immediately-completed one.
- Preserve existing non-`complete` settlement mappings — rules out widening this fix into workflow failure classification.
- Keep publication in the workflow tail — rules out moving workflow publication into the write loop.

## Task checklist

- Add a signal, alongside `publishCompletion: false`, that distinguishes "this row is the workflow's completion row, settled later by the publication tail" from "this row's publication is disabled with no owning tail."
- Change the write-loop completion boundary so a `complete` outcome only stays `in-progress` when that signal marks the row as the completion row; every other `publishCompletion: false` dispatch keeps settling `completed` immediately, as today.
- Widen `settleNonCompleteWorkflowStep`'s eligibility to also settle rows the write loop left deferred `in-progress`.
- Add a workflow-publication regression that observes the durable row at `boundary_committed` (before the workflow tail's own `setRunStatus` reset) as evidence-free `in-progress`, then at final settlement as evidence-bearing `completed`.
- Align the workflow runner's stale settlement comment with the completion-row-only deferral.
- Update the write-boundary, workflow-runner, and v1-parity documentation.
- Run the required scoped verification.

## Acceptance criteria

- [x] A complete write step whose row is the workflow's completion row leaves that row `in-progress` with no `prNumber`, `prUrl`, `terminalCause`, or `finishedAt` at `boundary_committed`; this pre-fix state is reachable in `v2/src/execution/write-loop.ts` because `keepsCompletionInProgress` excludes every `publishCompletion: false` dispatch, completion row or not.
- [x] A new `v2/src/execution/workflow-runner-publication.test.ts` regression asserts the completion step's `boundary_committed` log record carries `runStatus: "in-progress"` with the row still evidence-free at that point, then asserts the workflow's final row carries `completed`, `terminalCause: "complete"`, `prNumber`, `prUrl`, and `finishedAt`; it fails against the pre-fix boundary, which commits `runStatus: "completed"` at that same log record. (Observing state during the publisher call is insufficient: the workflow tail already resets the row to `in-progress` there via `store.setRunStatus` regardless of the boundary fix.)
- [x] `workflow-runner-debate.test.ts` tests `settles the step row and logs when a linked implement pass ends contract_miss after its write loop completed` and `settles the real link row when routing fails after that link's write loop completed` stay green — post-fix, the row each test corrects starts deferred `in-progress` instead of `completed`, so their assertions require the widened `settleNonCompleteWorkflowStep` eligibility.
- [x] `write-loop.test.ts`'s existing `publishCompletion: false` tests (`a workflow step (publishCompletion: false) commits progress iterations and leaves commits after a mid-run failure`, `no-work over dirty worktree with publishCompletion false settles non-completed failure naming uncommitted paths`) stay green and gain an assertion that a `publishCompletion: false` run with no completion-row signal settles `status: "completed"` immediately — pinning that the new signal's default does not strand a standalone row.
- [x] Existing fresh and resumed completion-publication tests in `v2/src/execution/write-loop.test.ts` stay green.
- [x] `v2/docs/write-behavior.md` states the write-boundary contract: a complete outcome owned by a later caller stays `in-progress` until that caller supplies evidence or a terminal cause; a `publishCompletion: false` outcome with no owning caller still settles immediately.
- [x] `v2/docs/workflow-runner.md` corrects the stale claim that `prepareWorkflowStep` always settles a workflow write row `completed` at its own boundary, states that only the resolved completion row defers, and documents `settleNonCompleteWorkflowStep`'s widened eligibility.
- [x] `v2/docs/v1-behaviors.md` records the corrected v2 workflow completion-row settlement behavior.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the write-boundary contract for caller-owned deferred completion vs. immediate settlement.
- `v2/docs/workflow-runner.md` — completion-row-only deferral and widened `settleNonCompleteWorkflowStep` eligibility.
- `v2/docs/v1-behaviors.md` — v2 behavior change from premature completion-row settlement to evidence-backed settlement.
