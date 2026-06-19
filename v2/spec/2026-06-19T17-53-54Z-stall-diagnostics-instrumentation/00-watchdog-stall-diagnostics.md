# Watchdog stall diagnostics

When patch-mode iteration watchdog fires, telemetry and the watchdog log line
carry last-output age and descendant liveness so stalls are diagnosable from
`~/.jarvis/runs.jsonl` and the session log without re-running.

## Problem

`spawn.ts` buffers stdout/stderr but never timestamps the last data event.
Watchdog-timeout telemetry (`patch/run.ts`) records only `exitReason` and
`watchdog_pgid`. A full-timeout stall is indistinguishable from active work
after the fact.

## Decisions

- Update `lastOutputAtMs` on every stdout/stderr `data` event in `spawn.ts`;
  expose via a caller-owned mutable ref on `AgentRunOptions`. Rules out
  inferring idleness from iteration wall-clock alone.
- Patch `run.ts` passes the ref into `agent.run` and reads it inside the
  existing iteration-timeout handler when `watchdogFired` is true. Rules out
  post-settle inference after the agent abort path returns.
- Sample descendant liveness once in the watchdog handler via
  `collectSubtree(pgid, listProcesses())` plus live PID checks (or
  equivalent one-shot). Rules out a new diagnostic polling loop separate from
  the existing reap sampler.
- Telemetry fields on `watchdog-iteration-timeout` rows only:
  `last_output_age_ms` (`number | null`, ms since last stdout/stderr chunk at
  watchdog fire; `null` when no output arrived) and `watchdog_descendants_alive`
  (`boolean`, true when the kill-time sample finds ≥1 live descendant of the
  agent pgid). Rules out emitting on `iteration-timeout` without watchdog fire.
- Append the same two values to the `[watchdog] iteration timeout fired …`
  harness log line (session log + stderr). Rules out telemetry-only diagnostics.
- Diagnostic-only: exit code `8`, SIGTERM→grace→SIGKILL sequence, and quota
  fallback unchanged. Rules out coupling instrumentation to watchdog policy.
- Patch mode only; prompt/plan watchdog paths unchanged in this subspec. Rules
  out cross-mode scope creep.

## Task checklist

- [ ] Add `lastOutputAtMs` ref support to `AgentRunOptions` and update it from
  `spawn.ts` on stdout/stderr `data`.
- [ ] In `patch/run.ts`, pass the ref per iteration; on watchdog fire compute
  `last_output_age_ms` and `watchdog_descendants_alive`, extend the watchdog log
  line, and include both fields on the timeout telemetry row.
- [ ] Extend `TelemetryRecord` / `writeTelemetry` wiring for the new optional
  fields.
- [ ] Add or extend a patch-mode integration test (mirror the existing watchdog
  pgid test) proving telemetry and log line carry both diagnostics.
- [ ] Update docs.

## Acceptance criteria

- [ ] A watchdog-fired patch iteration records `last_output_age_ms` and
  `watchdog_descendants_alive` on the `watchdog-iteration-timeout` telemetry
  row in `runs.jsonl`.
- [ ] The session log and harness stderr watchdog line include the same
  last-output age and descendant-liveness diagnostics.
- [ ] When the agent emits stdout/stderr before stalling, `last_output_age_ms`
  reflects time since that output (not the full `iterationTimeoutMs`).
- [ ] When the agent emits no stdout/stderr, `last_output_age_ms` is `null`.
- [ ] When a live descendant exists at watchdog fire (existing hang-agent
  fixture or equivalent), `watchdog_descendants_alive` is `true`.
- [ ] Exit code `8`, watchdog kill behavior, and quota-fallback semantics are
  unchanged from current behavior.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- [ ] `v1/docs/run-loop.md`: document `last_output_age_ms` and
  `watchdog_descendants_alive` on watchdog-timeout telemetry and the watchdog
  log line.
- [ ] `v2/docs/v1-behaviors.md`: record the extended watchdog-timeout telemetry
  shape with source citations.

## Out of scope

- Idle-output watchdog or any new abort bound.
- Descendant reaping / orphan cleanup changes.
- Prompt/plan watchdog instrumentation.
