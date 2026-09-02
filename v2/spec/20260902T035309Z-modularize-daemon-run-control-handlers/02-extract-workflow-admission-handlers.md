# Extract workflow-admission handlers

## Problem

Workflow admission RPC handlers (`check_workflow_start_claim`, `implement.recover`) and the workflow-specific helpers they share with `start` (claim checks, workflow dispatch/wait closures, review-progress reporting seams) remain embedded in the `createRunControlHandlers` closure, so workflow admission cannot be unit-tested apart from the full factory.

## Decision ledger

- New module `v2/src/daemon/daemon-workflow-admission-handlers.ts` owns `check_workflow_start_claim`, `implement.recover`, workflow-admission helpers still required by lifecycle `start`, and workflow closure helpers staged in `daemon.ts` by subspec 01 (`handleWorkflowStart`, claim paths inside `start`); rules out a fourth catch-all handler file or leaving these handlers inline.
- Workflow admission factories take `RunControlHandlerContext` and explicit deps; rules out reaching lifecycle internals through unstated closure capture.
- `start` stays in the lifecycle module from subspec 01; workflow admission exports only the helpers lifecycle `start` imports; rules out moving the `start` RPC handler into this module.
- `implement.recover` imports `resumeFinalizationOnly` from the lifecycle module one directionally; rules out duplicating finalization logic in workflow admission or leaving the helper in `daemon.ts`.
- RPC contracts stay unchanged; rules out admission semantics changes during extraction.

## Task checklist

- [ ] Move `check_workflow_start_claim` and `implement.recover` handlers plus shared workflow-admission helpers and workflow closure helpers staged in `daemon.ts` by subspec 01 into `daemon-workflow-admission-handlers.ts`.
- [ ] Export factories consumed by `daemon-run-lifecycle-handlers.ts` for workflow paths inside `start`.
- [ ] Wire workflow-admission handlers from `createRunControlHandlers` through the new module.
- [ ] Add `daemon-workflow-admission-handlers.test.ts` with direct tests for claim-check refusal/admission and `implement.recover` happy-path/refusal shapes.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-workflow-admission-handlers.test.ts` exercises workflow-admission handlers through the extracted module; it fails against the pre-fix tree where these handlers live only inside `daemon.ts`.
- [ ] `v2/src/daemon/daemon-workflow-start.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `bun run typecheck` passes.

## Documentation updates

None — handler module map is updated in subspec 06.
