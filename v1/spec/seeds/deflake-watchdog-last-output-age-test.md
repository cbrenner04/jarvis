---
name: deflake-watchdog-last-output-age-test
---

# Deflake the watchdog last_output_age_ms test (flakes under suite load)

## Problem

`v1/test/run.sandbox-unrunnable.test.ts` › "watchdog timeout records
last_output_age_ms from early output then stall" flakes under full-suite load:
it expects `typeof timeoutRow?.last_output_age_ms === "number"` but intermittently
receives `null` (`typeof === "object"`). In isolation it passes reliably (11/11
verified). Under the completion ready gate's full `bun test` (CPU pressure /
concurrent runs) it tips over, **blocking otherwise-complete runs**: the
`per-subrole-agent-order-tiering` run hit exit 7 (blocked) twice solely because
this unrelated test went red during its gate, even though its own targeted suites
passed.

Second load-flaky test poisoning gates this session — sibling to the
spawn-classification deflake (shipped, the prior `2026-06-25` spawn flake) and
the general ready-gate flake-tolerance intake #519. This is the specific
offending test.

## Direction

De-flake the test so it doesn't gate-fail under load. Make the
`last_output_age_ms` capture deterministic — inject a fake clock / drive the
watchdog timing without real wall-time sleeps so the "early output then stall"
sequence reliably records a number, not `null` — rather than weakening the
assertion. Independent of #519's gate-level retry policy; fix the test itself.

## Out of scope

- General ready-gate flake-retry policy (#519).
- Other watchdog behavior changes.

## References

- `v1/test/run.sandbox-unrunnable.test.ts` (watchdog last_output_age_ms test).
- Observed 2026-06-26: blocked `per-subrole-agent-order-tiering` (exit 7 ×2);
  passes 11/11 in isolation.
