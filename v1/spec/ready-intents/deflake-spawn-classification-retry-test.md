---
name: deflake-spawn-classification-retry-test
---

# spawn-classification retry test no longer gate-fails under full-suite load

## Behavior

`v1/test/agents/spawn-classification.test.ts` › "stderr matching both auth and
transient retries same agent on error kind" passes reliably when the full suite
runs under CPU pressure, instead of tipping over its 5000ms timeout (~5001ms)
during the completion ready gate's `bun test` step.

De-flake the test itself — independent of intake #519's gate-level flake-retry
policy. Make it not depend on wall-time under load: either remove its timing
sensitivity (inject a fake clock / drop real sleeps so classification is
deterministic) or raise its arbitrary 5s bound well above the contended worst
case. The six existing assertions in the describe block keep their current
expected results.

## Out of scope

- General ready-gate flake-retry policy (intake #519).
- Operator runbook guidance on concurrent `jarvis run` gates.

## Prerequisites
