# 00 - Persist review-debate lifecycle

## Problem

The shared workflow runner synthesizes a review-debate run ID and excludes the step from durable state. Successful and failed debate outcomes therefore disappear after the live workflow exits, and daemon restart cannot reconcile an active debate step.

## Decisions

- Persist one run and one attempt per reached authored `review-debate` step; rules out per-role rows that fragment one step's lifecycle.
- Create and settle the row in shared `review-debate` dispatch; rules out plan-preset wiring that makes identical authored steps differ by caller.
- Map debate success to `completed`, role or landing failure to `failed`, and daemon-reconciled debate interruption to terminal `interrupted`; rules out treating either non-success outcome as `completed` or collapsing restart interruption into `killed`.
- Keep the existing fixed debate cycle atomic inside one attempt; rules out inventing mid-cycle replay checkpoints before a resume consumer exists.
- Deferred to first consumer: mid-cycle review-debate resume and replay semantics — pin when a caller needs it.

## Task checklist

- Give every reached review-debate step durable `(project, branch, stepId)` identity, one attempt, and its workflow snapshot.
- Commit successful and failed debate boundaries to the row, including deferred-landing failure.
- Extend durable status and daemon reconciliation semantics so an orphaned review-debate row becomes `interrupted` without changing existing non-debate kill semantics.
- Include review-debate rows in workflow rollup and fresh-dispatch handling.
- Add focused shared-runner, state-store, rollup, and restart-reconciliation coverage.
- Update the durable docs listed below.

## Acceptance criteria

- [x] A reached `review-debate` step owns one durable run row keyed by `(project, branch, stepId)` and one attempt spanning all debate cycles and roles.
- [x] A successful debate commits `completed`; a role or deferred-landing failure commits `failed`; neither failure path commits `completed`.
- [x] Daemon restart reconciles an orphaned review-debate row to terminal `interrupted`, retains its authored workflow metadata, and does not change existing non-debate reconciliation to `killed`.
- [x] A fresh dispatch creates a new debate row, while the existing no-mid-cycle-resume boundary remains explicit.
- [x] `v2/src/execution/workflow-runner.test.ts` adds a shared `review-debate` dispatch regression that observes the durable in-progress row and terminal success/failure rows and fails against the baseline.
- [x] `v2/src/daemon/daemon-reconciliation.test.ts` adds a restart regression for an interrupted review-debate row that fails against the baseline.
- [x] `v2/src/daemon/workflow-run-status-rollup.test.ts` covers durable review-debate success, failure, and interruption in workflow status.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — durable review-debate identity, lifecycle, rollup, and deferred mid-cycle resume boundary.
- `v2/docs/state-store.md` — review-debate row/attempt semantics and debate-specific `interrupted` reconciliation.
