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

- Caller-owned per-iteration mutable ref `{ current: number | null }` on
  `AgentRunOptions` (`lastOutputAtMs`); init `null` before each `agent.run`;
  `spawn.ts` sets `current = Date.now()` on every stdout/stderr `data` event.
  Rules out inferring idleness from iteration wall-clock alone.
- Snapshot `last_output_age_ms` and `watchdog_descendants_alive` inside the
  iteration-timeout callback when `watchdogFired` becomes true — before the
  first group `SIGTERM` and before `agent.run` settles; post-`agent.run` timeout
  telemetry and log fanout consume the frozen values only. Rules out
  post-settle reads that inflate output age or false-negative liveness after
  SIGKILL.
- Sample descendant liveness once in that callback, immediately before the first
  `SIGTERM` to the agent process group. Rules out sampling after grace/SIGKILL.
- “Descendants” = `collectSubtree(agentRootPid, listProcesses())` from the agent
  root pid set in `onSpawned` (`watchdogPgid`), using reap's transitive `ppid` +
  shared-`pgid` semantics; `watchdog_descendants_alive` is true when ≥1 sampled
  pid is live at snapshot time. Rules out naive pgid-only membership or a new
  diagnostic polling loop.
- Failed or empty `listProcesses()` at snapshot time →
  `watchdog_descendants_alive: false`. Rules out a tri-state liveness enum.
- Telemetry fields on `watchdog-iteration-timeout` rows only:
  `last_output_age_ms` (`number | null`, ms since last stdout/stderr chunk at
  snapshot; `null` when no output arrived) and `watchdog_descendants_alive`
  (`boolean`). When `watchdogPgid === null`, still emit `last_output_age_ms`;
  omit `watchdog_descendants_alive` (same optional pattern as `watchdog_pgid`).
  Rules out emitting on `iteration-timeout` without watchdog fire.
- Extend the existing watchdog log line with fixed suffix (same snake_case keys
  and values as telemetry):
  `last_output_age_ms=<n|null> watchdog_descendants_alive=<true|false>` (omit
  the `watchdog_descendants_alive` token when pgid unavailable). Rules out
  telemetry-only diagnostics or unpinned log encoding.
- Diagnostic-only: exit code `8`, SIGTERM→grace→SIGKILL sequence, and quota
  fallback unchanged. Rules out coupling instrumentation to watchdog policy.
- Patch mode only; prompt/plan watchdog paths unchanged in this subspec. Rules
  out cross-mode scope creep.

## Task checklist

- [ ] Add `lastOutputAtMs` ref to `AgentRunOptions` (inline doc-comment per
  `v2/docs/documentation-standard.md`); update from `spawn.ts` on stdout/stderr
  `data`.
- [ ] In `patch/run.ts`, init the ref per iteration; in the watchdog callback
  snapshot `last_output_age_ms` and `watchdog_descendants_alive` before first
  group `SIGTERM`; extend the watchdog log line; pass frozen values to timeout
  telemetry after `agent.run` settles.
- [ ] Extend `TelemetryRecord` / `writeTelemetry` wiring for the new optional
  fields.
- [ ] Add or extend patch-mode integration tests: (a) hang-agent fixture — no
  pipe output, live descendant; (b) early stdout/stderr then stall — age well
  below `iterationTimeoutMs`; (c) agent-only stall — no live descendants.
- [ ] Update docs.

## Acceptance criteria

- [ ] A watchdog-fired patch iteration records `last_output_age_ms` and
  `watchdog_descendants_alive` on the `watchdog-iteration-timeout` telemetry
  row in `runs.jsonl` (omit `watchdog_descendants_alive` when pgid unavailable;
  still record `last_output_age_ms`).
- [ ] The session log and harness stderr watchdog line include the same
  diagnostics via the fixed suffix
  (`last_output_age_ms=<n|null> watchdog_descendants_alive=<true|false>`).
- [ ] Hang-agent fixture (no stdout/stderr, live grandchild at watchdog fire):
  `last_output_age_ms` is `null` and `watchdog_descendants_alive` is `true`.
- [ ] Early-output-then-stall fixture: `last_output_age_ms` is strictly less than
  `iterationTimeoutMs` minus a 500ms margin (fixture emits output, then idles
  for the remainder of the timeout).
- [ ] Agent-only stall fixture (no live descendants at snapshot):
  `watchdog_descendants_alive` is `false`.
- [ ] Exit code `8`, watchdog kill behavior, and quota-fallback semantics are
  unchanged from current behavior.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- [ ] `AgentRunOptions.lastOutputAtMs` inline doc-comment in `types.ts`.
- [ ] `v1/docs/run-loop.md`: document `last_output_age_ms` and
  `watchdog_descendants_alive` on watchdog-timeout telemetry and the watchdog
  log-line suffix.
- [ ] `v1/docs/quota-signals.md`: mention the new watchdog-timeout fields
  (parallel to `watchdog_pgid`).
- [ ] `v2/docs/v1-behaviors.md`: record the extended watchdog-timeout telemetry
  shape with source citations.

## Out of scope

- Idle-output watchdog or any new abort bound.
- Descendant reaping / orphan cleanup changes.
- Prompt/plan watchdog instrumentation.
