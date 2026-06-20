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
- Idle abort aborts the controller with a distinct reason (`idle-timeout`, distinct from the wall-clock `iteration-timeout`), and `runIteration` detects it via that reason in a branch placed **before** the quota-fallback path. Rules out the idle abort falling through to the lenient `probable-quota-fallback` branch (`run.ts:1596`) — which would emit agent-error telemetry, trigger fallback, and never return exit `8`, exactly the misroute the intent forbids.
- The idle telemetry branch populates the same diagnostic field set as the wall-clock branch (`last_output_age_ms`, `watchdog_pgid`, `watchdog_descendants_alive`) under its own `exitReason`. Rules out asserting the distinct `exitReason` while leaving the surrounding fields ambiguous; same diagnostic value applies to both timeouts.
- Reuse the process-group SIGTERM→grace→SIGKILL kill path and the iteration `AbortController` via one shared helper invoked by both watchdog callbacks (extracted from the current inline wall-clock block at `run.ts:1034-1053`, including the pre-abort descendant snapshot). Rules out a second kill mechanism, and rules out copying the block so the two paths cannot drift.
- Reset/scheduling is by polling the shared `lastOutputAtMs` ref or a self-rescheduling timer — no event hook required. Scheduling granularity means the abort may lag the configured span by up to one poll/scheduler tick; tests assert "before `iterationTimeoutMs`", not an exact deadline. Rules out asserting an exact idle deadline that a tick of slack would flake.
- Idle path mirrors the wall-clock pgid-null guard: if idle fires before spawn completes (`watchdogPgid === null`), skip the explicit group kill; `controller.abort` plus the spawn layer's own abort still kill the child. Rules out a null-pgid crash on a pre-spawn idle fire.

## Task checklist

- Add optional `idleOutputTimeoutMs` to the config type, validation (positive integer when present), and `config.md` field reference.
- Extract the inline SIGTERM→grace→SIGKILL kill + pre-abort descendant snapshot (`run.ts:1034-1053`) into a shared helper; have the wall-clock callback call it. Mirror the existing `pgid === null` guard inside it.
- Arm an idle watchdog in `runIteration` when `idleOutputTimeoutMs` is set: fire when `now - (lastOutputAtMs.current ?? armedAt) >= idleOutputTimeoutMs` (poll the shared `lastOutputAtMs` ref or self-reschedule); on fire, log a `[watchdog]` idle line, call the shared kill helper, and `abort` the controller with reason `idle-timeout`.
- Add an idle-abort branch in `runIteration` that matches `aborted: idle-timeout` and is ordered **before** the quota-fallback / `probable-quota-fallback` path; it returns exit `8` with `kind: "timeout"`, `exitReason: "watchdog-idle-timeout"`, and the same diagnostic fields as the wall-clock branch (`last_output_age_ms`, `watchdog_pgid`, `watchdog_descendants_alive`). Clear the idle timer in the existing `finally`.
- Tests: idle-abort fires before `iterationTimeoutMs` (tolerating one tick of lag); an output-emitting agent is not aborted; default-off matches the wall-clock-only baseline; idle abort returns exit `8`, is not classified as quota, triggers no fallback; the `[watchdog]` idle line is emitted.
- Docs: `v1/docs/run-loop.md`, `v1/docs/quota-signals.md`, `v1/docs/config.md`, `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] Config accepts an optional `idleOutputTimeoutMs`; when present it is validated as a positive integer and rejected otherwise, and when unset the idle watchdog is disabled.
- [x] With `idleOutputTimeoutMs` set well below `iterationTimeoutMs`, an iteration whose agent emits no further output for that span is aborted before `iterationTimeoutMs` elapses (test).
- [x] An agent that keeps emitting stdout/stderr within the span is not idle-aborted; the idle bound resets on agent output (test).
- [x] With `idleOutputTimeoutMs` unset, no idle abort fires and behavior matches the wall-clock-only baseline (test).
- [x] Idle abort is detected by its distinct `idle-timeout` reason in a branch ordered before the quota-fallback path; it returns exit code `8` with telemetry `kind: "timeout"`, `exitReason: "watchdog-idle-timeout"` (distinct from `watchdog-iteration-timeout`), and the wall-clock branch's diagnostic fields (`last_output_age_ms`, and `watchdog_pgid` / `watchdog_descendants_alive` when a pgid exists); it is not classified as quota and triggers no agent fallback (test).
- [x] Both watchdogs invoke one shared kill helper (the SIGTERM→grace→SIGKILL sequence and pre-abort descendant snapshot live in a single function, not copied per callback); when idle fires before spawn (`watchdogPgid === null`) the explicit group kill is skipped and `controller.abort` still aborts the iteration.
- [x] On idle abort the harness emits a `[watchdog]` idle line to stderr (test).
- [x] When `idleOutputTimeoutMs >= iterationTimeoutMs` the wall-clock watchdog wins; the idle timer is cleared by the existing `finally` so no idle fire occurs after iteration end. This edge relies on `finally` cleanup and is explicitly left untested.
- [x] `v1/docs/run-loop.md`, `v1/docs/quota-signals.md`, and `v1/docs/config.md` document the idle-output watchdog, its config knob, default-off behavior, and idle-vs-quota classification; `v2/docs/v1-behaviors.md` records the new idle-stall bounding behavior.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: the idle-output watchdog, its config knob, default-off, the `[watchdog]` idle line, and `watchdog-idle-timeout` telemetry.
- `v1/docs/quota-signals.md`: idle-abort timeout classification relative to quota fallback (abort path is never classified as quota).
- `v1/docs/config.md`: `idleOutputTimeoutMs` field reference (optional, unset by default).
- `v2/docs/v1-behaviors.md`: the new idle-stall bounding behavior alongside the existing iteration/run timeout entry.
