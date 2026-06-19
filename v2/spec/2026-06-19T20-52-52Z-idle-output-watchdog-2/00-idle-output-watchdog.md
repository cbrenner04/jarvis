# Idle-output watchdog

## Problem

The only iteration bound is wall-clock `iterationTimeoutMs` (default 30 min;
`v1/src/modes/patch/run.ts:1029`). An agent that goes idle — no stdout/stderr —
still burns the full timeout before the wall-clock watchdog aborts it. There is
no tighter bound keyed to the agent actually producing output.

Add an idle-output watchdog that aborts an iteration after a configurable span
of no agent output, well under `iterationTimeoutMs`. **Off by default**: with no
span configured the harness behaves exactly as today (wall-clock bound only).
The two watchdogs compose — the idle abort reuses the existing process-group
kill path and the exit-8 timeout path, and does not lower or replace
`iterationTimeoutMs`.

## Decisions

- New optional config field `idleOutputTimeoutMs`; unset = disabled. Rules out reusing/lowering `iterationTimeoutMs` and a boolean+separate-span pair.
- Validate `idleOutputTimeoutMs` as a positive integer only when present; no constraint relative to `iterationTimeoutMs`. Rules out enforcing idle < wall-clock (harmless if larger — wall-clock still bounds; operator tunes against live `last_output_age_ms`).
- Reset the idle bound on agent stdout/stderr only, via the existing `lastOutputAtMs` ref the spawn layer already updates. Rules out harness log lines masking a truly idle agent.
- When no output has arrived yet, measure idle from when the watchdog armed (agent spawn), not from first output. Rules out leaving the idle bound disarmed until first output, which would let an agent that never emits run to the full wall-clock bound.
- Idle abort returns exit `8` (same as wall-clock timeout) but telemetry uses a distinct `exitReason: "watchdog-idle-timeout"`. Rules out a new exit code and rules out reusing `watchdog-iteration-timeout` (which would blur idle from wall-clock in diagnostics).
- Reuse the process-group SIGTERM→grace→SIGKILL kill path and the iteration `AbortController`. Rules out a second kill mechanism racing the wall-clock watchdog or descendant reaping.

## Task checklist

- Add optional `idleOutputTimeoutMs` to the config type, validation (positive integer when present), and `config.md` field reference.
- Arm an idle watchdog in `runIteration` when `idleOutputTimeoutMs` is set: fire when `now - (lastOutputAtMs.current ?? armedAt) >= idleOutputTimeoutMs`; on fire, log a `[watchdog]` idle line, run the same process-group kill, and `abort` the iteration controller with an idle-specific reason.
- Surface the idle abort in `runIteration` as exit `8` with `kind: "timeout"`, `exitReason: "watchdog-idle-timeout"`, and `last_output_age_ms`; clear the idle timer in the existing `finally`.
- Tests: idle-abort fires before `iterationTimeoutMs`; an output-emitting agent is not aborted; default-off matches the wall-clock-only baseline; exit `8` and quota-fallback semantics preserved.
- Docs: `v1/docs/run-loop.md`, `v1/docs/quota-signals.md`, `v1/docs/config.md`, `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] Config accepts an optional `idleOutputTimeoutMs`; when present it is validated as a positive integer and rejected otherwise, and when unset the idle watchdog is disabled.
- [ ] With `idleOutputTimeoutMs` set well below `iterationTimeoutMs`, an iteration whose agent emits no further output for that span is aborted before `iterationTimeoutMs` elapses (test).
- [ ] An agent that keeps emitting stdout/stderr within the span is not idle-aborted; the idle bound resets on agent output (test).
- [ ] With `idleOutputTimeoutMs` unset, no idle abort fires and behavior matches the wall-clock-only baseline (test).
- [ ] Idle abort returns exit code `8` with telemetry `kind: "timeout"` and `exitReason: "watchdog-idle-timeout"` (distinct from `watchdog-iteration-timeout`), includes `last_output_age_ms`, and reuses the process-group SIGTERM→grace→SIGKILL kill path; it is not classified as quota and does not trigger agent fallback (test).
- [ ] `v1/docs/run-loop.md`, `v1/docs/quota-signals.md`, and `v1/docs/config.md` document the idle-output watchdog, its config knob, default-off behavior, and idle-vs-quota classification; `v2/docs/v1-behaviors.md` records the new idle-stall bounding behavior.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: the idle-output watchdog, its config knob, default-off, the `[watchdog]` idle line, and `watchdog-idle-timeout` telemetry.
- `v1/docs/quota-signals.md`: idle-abort timeout classification relative to quota fallback (abort path is never classified as quota).
- `v1/docs/config.md`: `idleOutputTimeoutMs` field reference (optional, unset by default).
- `v2/docs/v1-behaviors.md`: the new idle-stall bounding behavior alongside the existing iteration/run timeout entry.
