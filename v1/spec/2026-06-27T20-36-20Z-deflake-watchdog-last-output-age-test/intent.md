---
name: deflake-watchdog-last-output-age-test
---

# Deflake the watchdog last_output_age_ms test

## Problem

`v1/test/run.sandbox-unrunnable.test.ts` › "watchdog timeout records
last_output_age_ms from early output then stall" flakes under full-suite load:
it expects `typeof last_output_age_ms === "number"` but intermittently gets
`null` under CPU pressure. Passes 11/11 in isolation. The flake red-gates
unrelated runs (e.g. `per-subrole-agent-order-tiering` blocked exit 7 ×2).

## Direction

Make the `last_output_age_ms` capture deterministic: drive the watchdog timing
via injected/fake clock so the "early output then stall" sequence reliably
records a number, not `null`, without real wall-time sleeps. Fix the test —
do not weaken the assertion.

## Out of scope

- General ready-gate flake-retry policy (#519).
- Other watchdog behavior changes.

## Prerequisites
