---
name: stage-timeout-incident-cause-from-durable-runs
---

# Derive linked-stage timeout incident causes from durable runs

Unsplit rationale: The fix changes one module-boundary surface: daemon operator-incident derivation; stage settlement and failure-record contracts remain unchanged.

## Primary implementation surface

- `v2/src/daemon/operator-incidents.ts`

## Problem

Linked-stage settlement now stores a failing run's `OperatorFailureRecord` unchanged when present. `stageFailedCause` still reads `terminalCause` from that record, although the record has no such field, so a stage settled from a timeout through the no-`loadLogRecords` path emits incident cause `failed` instead of `run_timeout`.

## Behavior

Derive a failed linked stage's incident cause from its attributed durable invocation rows. A `run_timeout` row yields `run_timeout`; other stored failure records yield `failed`. Preserve the stage's canonical `OperatorFailureRecord` unchanged and do not change daemon settlement behavior, record shape, or unrelated incident derivation.

## Acceptance criteria

- [ ] A regression test settles a linked stage with no `loadLogRecords` from a timeout run carrying an `OperatorFailureRecord`, then proves its stage or terminal-pipeline incident has cause `run_timeout`; it fails against the pre-fix `stage.failureDetail.terminalCause` read.
- [ ] A test proves the same settlement path with a non-timeout stored record derives incident cause `failed`.
- [ ] The settled stage's `failureDetail` remains the stored `OperatorFailureRecord` unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — state that linked-stage timeout notification causes derive from durable invocation rows while canonical stage failure detail remains unchanged.
- `v2/docs/v1-behaviors.md` — record the corrected v2 incident derivation.

## Prerequisites

- Failed linked stages retain their admitted entry-run id in `workflowInvocationId` after settlement.
- Linked-stage settlement stores the failing run's valid `OperatorFailureRecord` unchanged and uses composed detail only as fallback.
