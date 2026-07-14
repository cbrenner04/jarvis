---
name: shared-invocation-idle-output-watchdog
---

# shared/invocation aborts an invocation that emits no output for the idle budget

`shared/invocation` currently arms nothing: an agent subprocess that goes silent runs until the
caller's wall-clock timeout. Give the shared invocation path an idle-output watchdog so v1 and v2
share one watchdog rather than growing a second.

## Behavior

- A binding invocation carries an idle-output budget (caller-supplied; unset/0 = disabled).
- Every stdout/stderr chunk from the child bumps a last-output timestamp.
- No chunk for the budget aborts the invocation (same process-group kill path as the existing
  abort-signal route) and settles it as a stall-classified failure, distinguishable from quota,
  `model_config`, and a generic `error`.
- Stall is not classified as quota.

Scope stops at detection + abort + classification inside `shared/invocation`. Consuming the stall
(escalation) and recording the measurement are separate behaviors.

## Prerequisites

- claude's output arrives incrementally through `shared/invocation` rather than as one exit-time batch
- shared invocation settles agent results into `ok | quota | model_config | error` with an abort path

## Out of scope

- Workspace-mtime and step-marker progress signals (`v2/docs/invocation-liveness.md` multi-category model).
- Cursor's partial output unobservability — a working watchdog would kill cursor.

## Documentation updates

- `v2/docs/invocation-liveness.md` — the shipped stall-detection signal and its budget; narrow the deferred list.
- `v2/docs/shared-invocation.md` — stall as a settled result kind.
- `v2/docs/v1-behaviors.md` — v2 divergence row for invocation liveness.
