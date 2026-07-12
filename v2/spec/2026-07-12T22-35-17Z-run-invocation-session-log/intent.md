---
name: run-invocation-session-log
---

# Each agent invocation writes a durable session log

v2 leaves no on-disk evidence that an agent subprocess ran when a write-step invocation stalls or fails before structured events accrue. Capture per-invocation agent stdout/stderr durably, v1-style under `~/.jarvis/sessions/`, opened before spawn and closed at invocation settle.

## Decisions

- One session log file per write-loop invocation attempt — rules out one shared file for the whole run and rules out structured-log duplication of raw stdout/stderr.
- Log layout follows v1 session tags (`harness`, `outbound`, `inbound_stdout`, `inbound_stderr`) — rules out inventing a new transcript format ahead of the first consumer.
- Deferred to first consumer: filename slug beyond `~/.jarvis/sessions/<namespace>-<timestamp>.log` — pin when non-write surfaces need session logs.

Update `v2/docs/daemon-host.md` with where invocation session logs live, `v2/docs/first-workflow-walkthrough.md` with a session-log recovery step, and `v2/docs/v1-behaviors.md` for v2 session-log parity.

## Prerequisites
