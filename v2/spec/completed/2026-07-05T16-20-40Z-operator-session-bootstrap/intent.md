---
name: operator-session-bootstrap
---
# Operator Session Bootstrap

# Operator session bootstrap mints a stable operator_session_id

`v2/docs/telemetry-capture.md` pins `operator_session_id` as the join key tagging
all runs started in one operator sitting, assigned at "CLI/daemon session
bootstrap or first `start`." No such bootstrap exists yet in `v2/src` — nothing
mints, persists, or exposes an `operator_session_id`. This blocks any live
`invocation_completed` emission, since the record's envelope requires it.

Deliverable: the CLI host and the daemon host each mint one stable
`operator_session_id` per operator sitting (CLI: per process invocation;
daemon: per daemon process lifetime, covering every run/workflow it starts)
and make it available to callers that construct invocation telemetry context.

## Prerequisites

- `shared/invocation/execute.ts` defines `InvocationTelemetryContext.operatorSessionId` as a required field with no current minting source
