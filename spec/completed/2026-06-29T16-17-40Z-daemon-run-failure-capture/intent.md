---
name: daemon-run-failure-capture
---

# Daemon run failure capture

When a daemon-hosted run throws outside normal loop outcomes, capture it as a durable failed run state with one structured log event, then release ownership. The operator should find a failed run instead of an orphaned in-progress run or a vanished exception.

## Scope

- Wrap daemon run execution boundaries with failure capture.
- Mark the run failed when the state store is reachable.
- Emit a structured failure event when the log sink is reachable.
- Release in-memory worktree ownership on failure.
- Preserve the original thrown error for daemon diagnostics/tests.

## Out of scope

- Automatic retry.
- Operator notification.
- Recovering when both state store and log sink are unavailable.
- Human-loop routing.

## Decisions

- Capture unexpected run exceptions as `failed`, not `blocked` — rules out implying agent/spec action can fix harness faults.
- Release ownership after failure capture — rules out leaving the branch permanently claimed by a dead run.
- State failure is primary and log failure is secondary — rules out a logging outage masking the run's failed state.
- Deferred to first consumer: exact failure event payload — pin when daemon log tail consumes it.

## Documentation updates

- `v2/docs/v2-architecture.md` — record daemon-owned failure capture and ownership release semantics.
- `v2/docs/daemon-host.md` — document run execution failure behavior once run hosting exists there.

## Prerequisites

- Daemon can host run execution and owns in-memory worktree claims.
- Runs have durable `failed` status.
- Structured log stream can append run-scoped events.
