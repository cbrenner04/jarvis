# Seed: shared/invocation abort path does not clear the idle-output timer

## Problem

In `shared/invocation/agents.ts`, `handleAbort` (the `AbortSignal` path) calls
`killProcessGroup()` and sets `abortReason` but never clears/disarms the idle-output `idleTimer`
armed by `armIdleTimer`. If a future caller supplies **both** `signal` and `idleOutputMs`, and the
idle timer fires during the abort grace window (after `SIGTERM`, before the process closes), the
timer callback calls `killProcessGroup()` again and `settle({kind:"stall"}, true)` — silently
overriding what should be an `{kind:"error", stderr:"aborted: <reason>"}` result.

Currently unreachable (no shipped caller combines `idleOutputMs` with a `signal`), so it violates
no AC and breaks no test — but it is a real race in the exact abort+classification logic the
idle-output-watchdog spec (#1610) owns. Surfaced by the #1610 review.

## Decisions

- `handleAbort` must clear the idle timer before/at settle, so an in-flight idle fire cannot
  reclassify an abort as a `stall`.

## Acceptance criteria

- [ ] `handleAbort` clears `idleTimer` so a pending idle fire during the abort grace window cannot
      override the abort result.
- [ ] Regression test: `signal` + `idleOutputMs` set, idle timer fires mid-abort → result is the
      abort error, not `stall`.

## Documentation updates

- None (internal invariant); note in `v2/docs/invocation-liveness.md` if it documents the watchdog.
