---
name: resume-failed-pipeline-branch
---

# Resume One Failed Pipeline Branch

## Prerequisites

- The state store atomically reopens a valid failed continuation and skipped suffix for one named fan-out branch while leaving sibling rows untouched, and omission of branch scope retains whole-pipeline reopen behavior.

## Primary implementation surface

`v2/src/daemon/pipeline-execution.ts`

## Problem

Resume orchestration gates on the pipeline's aggregate derived state, so sibling awaiting gates prevent a failed branch from reaching its replay path.

## Behavior

Resume orchestration can evaluate, reopen, and continue one named fan-out branch independently of aggregate sibling state while retaining the existing unscoped pipeline-resume path.

## Decisions

- Branch-scoped resume selects a replayable failed workflow stage from the named branch and calls continuation with that branch key; rules out whole-pipeline suffix walking.
- Sibling awaiting gates do not veto the named branch's replay, and sibling rows receive no dispatch or mutation; rules out aggregate `awaiting-approval` as branch admission authority.
- An awaiting gate on the named branch refuses before reopen or dispatch with a reason naming the branch key and gate stage; rules out silent success and implicit approval.
- A missing branch or named branch without a replayable failure refuses with branch-specific detail; rules out fallback to an arbitrary failed sibling.
- Omitting the branch key follows the existing derived-state, reopen, claim-only-awaiting, and continuation semantics exactly; rules out changing whole-pipeline resume.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` fails against the baseline, then proves branch-scoped resume reopens and dispatches only an approved branch's failed stage while sibling branches remain at awaiting gates.
- [ ] `pipeline-execution.test.ts` proves the named branch's own awaiting gate, an unknown branch, and a branch without a replayable failure each refuse with branch-specific detail and no dispatch.
- [ ] Existing unscoped `resumePipeline` tests stay green.

## Documentation updates

- `v2/docs/workflow-runner.md` — branch-local resume admission and per-branch continuation scope.
- `v2/docs/v1-behaviors.md` — v2 branch-scoped pipeline execution semantics and preserved unscoped behavior.
