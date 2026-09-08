# Document pipeline-execution fan-out plan dispatch binding

## Problem

`v2/docs/pipeline-execution.md` documents branch-scoped plan downstream-input resolution but not how fan-out `{ results }` bind to lanes during dispatch and recovery, or how that differs from branch-scoped approval continuation.

## Prerequisites

- `00-branch-key-fan-out-plan-result-binding` (document landed behavior only).

## Decision ledger

- Record branch-key result binding and mismatch refusal under the existing Fan-out lanes section; rules out duplicating the full binder walkthrough in `daemon-host.md`.
- Distinguish branch-scoped approval continuation (single-path `{ steps }` via `resolveStageWorkflowSteps`) from default-row simultaneous fan-out admission (`isFanOutStageResolution` → `advanceFanOutBranches` binding `{ results }` by branch key); rules out repeating serial-approval confusion in durable docs.

## Tasks

- Update `v2/docs/pipeline-execution.md` Fan-out lanes prose to state that branch-scoped approval continuation resolves single-path `{ steps }` for the approved lane only, while default-row simultaneous fan-out admission binds fan-out `{ results }` to lanes by `branchKeyFromDownstreamInput(downstreamInputs[i])` equality (not `branchKeys` / `split.branchKeys` index into `{ results }`), that binding refusal names the affected lane and downstream input before dispatch, and that plan recovery uses the same branch-key binding for fan-out-shaped resolutions plus `singleStageResolutionSteps` for named lanes with single-path `{ steps }`.

## Acceptance criteria

- [ ] `v2/docs/pipeline-execution.md` documents branch-key fan-out plan result binding across dispatch and recovery, mismatch refusal semantics, and the continuation-versus-fan-out-dispatch split.

## Documentation updates

- None beyond the acceptance criterion above.
