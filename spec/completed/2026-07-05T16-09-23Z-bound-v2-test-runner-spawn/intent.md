---
name: bound-v2-test-runner-spawn
---

# Bound `run-v2-tests.ts` spawnSync calls to a timeout

## Problem

`scripts/run-v2-tests.ts` runs `spawnSync("bun", ["test", ...], { stdio: "inherit" })`
with no timeout, for both the per-file loop and the `agent` mode's parallel
run. A stalled `bun test` process under CI load blocks the job forever
instead of failing. Observed hanging CI `Test (v2)` runs on PR #1003 that
never reproduced locally.

## Decisions

- Bound every `spawnSync` call in this file (kill + fail on timeout) — rules out a workflow-level CI job timeout masking the failure site.
- On timeout, fail with a message naming the mode/file that was running — rules out a silent/opaque non-zero exit.
- Root-causing the underlying stall is out of scope — rules out chasing an unreproducible race instead of bounding the failure mode.
- `scripts/ci-test-scope.ts` and other CI-scoping logic are unaffected — rules out widening this into a CI-scoping change.

## Documentation updates

- `v1/docs/operator-runbook.md` — extend the existing shrink-hang gotcha (or add a sibling note) to cover `Test (v2)` hangs on the same unbounded-`spawnSync` pattern.

## Prerequisites
