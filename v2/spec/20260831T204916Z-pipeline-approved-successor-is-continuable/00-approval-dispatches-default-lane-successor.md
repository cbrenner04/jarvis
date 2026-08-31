# Approval dispatches the default-lane successor

## Primary implementation surface

Daemon pipeline continuation and resume admission in `v2/src/daemon/pipeline-execution.ts`.

## Problem

`pipeline approve <pipeline-id> <stage-id> default` durably records `approved` but passes the `default` lane sentinel as a scoped continuation, so `runPipeline` skips the default prefix and leaves the successor `pending` with `workflowInvocationId: null` until a daemon-restart continuation sweep.

## Decision ledger

- Normalize `branchKey: "default"` to unscoped whole-pipeline continuation at every `continuePipeline` / `runPipeline` entry; rules out treating the sentinel as a named fan-out suffix and skipping the default prefix.
- Post-approve continuation still dispatches only the approved lane on fan-out pipelines; rules out widening named-lane scoping or dispatching sibling branches.
- Approval on the already-running admitting daemon dispatches the successor immediately; rules out requiring `recoverContinuablePipelines` after a live approve.
- Deferred to first consumer: successor dispatch failure settlement — remains on the existing `continuePipeline` path; no new settlement AC unless citing an existing preservation test.

## Tasks

- Add one shared continuation-scope normalizer in `pipeline-execution.ts` and apply it in `applyPipelineApprovalDecision`, `continuePipeline`, and `runPipeline`.
- Add daemon RPC regression coverage for `pipeline_approve` with explicit `branchKey: "default"` proving the pending successor gains `workflowInvocationId` without restart or continuation sweep.
- Add regression coverage proving approval on the already-running admitting daemon reaches the same successor-dispatch path without invoking `recoverContinuablePipelines`.
- Update approval continuation and default-lane scope docs in the durable homes listed below.

## Acceptance criteria

- [x] `daemon-pipeline-approval.test.ts` sends `pipeline_approve` with `branchKey: "default"` after a succeeded predecessor and proves the admitting daemon creates the pending successor's run linkage without restart; it fails against the pre-fix path that leaves the successor `pending` with `workflowInvocationId: null`.
- [x] `daemon-pipeline-approval.test.ts` proves approval on a freshly created handler dispatches the successor without invoking `recoverContinuablePipelines`; it fails against the pre-fix path that depends on a later startup continuation sweep.
- [x] `pipeline-execution.test.ts` — `approve-intent continuation dispatches only the approved branchKey` stays green.
- [x] `v2/docs/pipeline-execution.md` documents that approval dispatches the successor on the admitting daemon and that `branchKey: "default"` aliases unscoped whole-pipeline continuation scope.
- [x] `v2/docs/operator-runbook.md` documents that approval on an already-running admitting daemon advances the successor without daemon restart.
- [x] `v2/docs/v1-behaviors.md` records corrected post-approve successor dispatch for the default lane in the v1 parity baseline.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/pipeline-execution.md` — approval successor dispatch on the admitting daemon; `default` lane as whole-pipeline continuation scope.
- `v2/docs/operator-runbook.md` — approval advances without restart on an already-running admitting daemon.
- `v2/docs/v1-behaviors.md` — corrected default-lane approval continuation behavior.
