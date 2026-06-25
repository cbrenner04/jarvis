---
name: spawn-classification-test-flakes-under-suite-load
---

# spawn-classification test times out under full-suite load, poisoning completion gates

## Problem

`v1/test/agents/spawn-classification.test.ts` › "spawn classification order …
> stderr matching both auth and transient retries same agent on error kind" has
a **5000ms** test timeout and tips over (~5001ms) when the full ~1580-test suite
runs under CPU pressure. In isolation it passes 6/6 reliably (verified 3×).

This single flake repeatedly failed the **completion ready gate** during the
2026-06-25 session, stranding correct implementation work: two `jarvis run`
iterations hit `watchdog-iteration-timeout (exit 8)` and one hit `exit 1`, each
solely because this test crossed its 5s bound during the gate's `bun test` step
— even on the serial retry, since other concurrent runs were competing. The
implementations were fine; the gate was poisoned by an unrelated timing test.

Related: intake #519 (general ready-gate flake tolerance). This is the specific
offending test.

## Direction

De-flake the test so it doesn't gate-fail under load. Options to weigh:

- Raise this test's timeout well above 5000ms (it's a retry-classification test;
  the 5s bound is arbitrary and timing-sensitive).
- Or make the test deterministic (inject a fake clock / remove real sleeps so it
  doesn't depend on wall-time under load).
- Independent of #519's gate-level flake tolerance — fix the test itself.

## Out of scope

- General ready-gate flake-retry policy (intake #519).
- The observer-side lesson "don't run many `jarvis run` gates concurrently"
  (operator-runbook, not a code change).

## References

- `v1/test/agents/spawn-classification.test.ts`.
- Observed 2026-06-25 overlord session (exit 8 ×2, exit 1 ×1 on this test).
