---
name: workflow-runner-invocation-telemetry-parity
---
# Workflow Runner Invocation Telemetry Parity

# Workflow runner emits invocation_completed telemetry with identical schema for write and review-debate steps

`shared/invocation/execute.ts` already emits `invocation_completed` rows when a
caller supplies telemetry context, and both `v2/src/execution/write.ts` and
`v2/src/execution/review-debate.ts` already thread an optional `telemetry`
field down to that seam. Nothing constructs or passes that context today:
`v2/src/execution/workflow-runner.ts`, `v2/src/cli.ts`, and
`v2/src/daemon/daemon.ts` never populate `telemetry` on either a write step or
a review-debate step, so no `invocation_completed` rows are emitted live for
either behavior. This is F2 from `v2/docs/telemetry-capture.md` /
`v2/docs/v2-build-order.md`: land cross-behavior parity in one slice so the
first live emission is never a write-only fork.

Deliverable: `executeWorkflow` (`v2/src/execution/workflow-runner.ts`)
constructs one shared telemetry context per step — using the run/attempt
identity already tracked in the workflow snapshot, an injectable sink
defaulting to `~/.jarvis/telemetry.jsonl` (mirroring the state store's
`~/.jarvis/state/v2.sqlite` default-path pattern), and the operator session id
from session bootstrap — and passes it through identically to `write` steps
and `review-debate` steps. Same schema, same wiring path, for both.

Non-goal: a `plan` workflow-step behavior does not exist in `v2/src` yet
(only `write`, `human`, `review-debate`); parity for plan steps is out of
scope here and deferred until that step behavior exists.

## Prerequisites

- An operator_session_id is available to mint into invocation telemetry context
- `review-debate` is a dispatchable `workflow-runner.ts` step behavior
- `shared/invocation/execute.ts` emits `invocation_completed` rows when passed a telemetry context and sink
