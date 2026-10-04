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

Derive a failed linked stage's incident cause from durable rows sharing its admitted entry run's invocation id. Any attributed row with `terminalCause: "run_timeout"` yields `run_timeout`, including when other attributed rows have non-timeout failures; otherwise, including when the entry run, invocation id, or attributed rows are absent, yield `failed`. Preserve the stage's canonical `OperatorFailureRecord` unchanged and do not change daemon settlement behavior, record shape, or unrelated incident derivation.

## Acceptance criteria

- [ ] A regression test settles a linked stage with no `loadLogRecords` from a timeout run carrying an `OperatorFailureRecord`, then proves its stage or terminal-pipeline incident has cause `run_timeout`; it fails against the pre-fix `stage.failureDetail.terminalCause` read.
- [ ] A test proves an attributed invocation with both timeout and non-timeout durable rows derives `run_timeout`.
- [ ] A test proves the same settlement path with only non-timeout rows, or no resolvable attributed rows, derives incident cause `failed`.
- [ ] The settled stage's `failureDetail` remains the stored `OperatorFailureRecord` unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — state that linked-stage timeout notification causes derive from any durable row sharing the entry-run invocation id, override non-timeout rows, fall back to `failed` when no rows resolve, and leave canonical stage failure detail unchanged.
- `v2/docs/v1-behaviors.md` — record the corrected v2 incident derivation.

## Prerequisites

- Failed linked stages retain their admitted entry-run id in `workflowInvocationId` after settlement.
- Linked-stage settlement stores the failing run's valid `OperatorFailureRecord` unchanged and uses composed detail only as fallback.
