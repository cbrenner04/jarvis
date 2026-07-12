---
name: run-async-path-terminal-log-event
---

# Unhandled run async failures become terminal structured-log events

Unhandled rejections or thrown errors on a run's async path after `iteration_started` must append a terminal structured-log record and settle durable run status — not vanish when daemon stdio is discarded. Spawn-boundary `run_execution_failed` already covers executor rejection at start; this slice covers failures deeper in the in-flight loop path that today leave only `iteration_started`.

## Decisions

- Reuse the existing `run_execution_failed` terminal kind — rules out a parallel failure event schema (seed out of scope).
- Append through the run's structured log sink before releasing in-memory liveness — rules out stderr-only reporting and rules out leaving `list` `in-progress` after an unhandled async failure.
- Best-effort durable status demotion to a terminal stop when not already terminal — rules out silent no-op when persistence fails (dual-outage remains out of scope per `daemon-host.md`).

Update `v2/docs/daemon-host.md` beyond spawn-boundary capture, `v2/docs/first-workflow-walkthrough.md` with structured terminal failure in the recovery path, and `v2/docs/v1-behaviors.md` for the new terminal path.

## Prerequisites
