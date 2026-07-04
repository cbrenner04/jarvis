---
name: v2-test-runner-unbounded-spawn
---

# `scripts/run-v2-tests.ts` can hang the CI `Test (v2)` job indefinitely

## Problem

Observed 2026-07-04 on PR #1003 (`tui-workflow-step-view`): the `Test (v2)`
CI job hung with no output for 9+ minutes on three consecutive runs of the
same commit, each cancelled by hand. All 366 v2 tests pass locally in ~2.5s
on the same commit both before and after — the hang did not reproduce
locally, and no other PR's `Test (v2)` job hung the same day.

`scripts/run-v2-tests.ts` runs `spawnSync("bun", ["test", ...files], {
stdio: "inherit" })` with **no timeout**. If any single test (or the `bun
test` process itself) stalls under CI's resource-constrained/contended
environment — the same class of race this repo already hit in
`v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` (see
`ci-shrink-test-hang` / `bound-shrink-sandbox-unrunnable-stalls`) — the
unbounded `spawnSync` call blocks the whole CI job forever instead of
failing. Not reproducing locally doesn't mean there's no bug: it means the
stall is load-triggered, and the real gap is that nothing bounds it.

## Scope (for plan → run)

- Add a bounded timeout (kill + fail) around the `spawnSync` call in
  `scripts/run-v2-tests.ts`, mirroring the bounded-fail pattern landed for
  the shrink test (see `bound-shrink-sandbox-unrunnable-stalls`).
- On timeout, fail the script with a clear message (e.g. which mode/file
  list was running) rather than hanging silently.

## Out of scope

- Root-causing which specific test/race triggers the underlying stall — this
  seed is about bounding the failure mode, not chasing an unreproducible
  root cause.
- `scripts/ci-test-scope.ts` or other CI-scoping logic — unaffected, only the
  final `bun test` invocation lacks a bound.

## Decisions (seed-level — refine in plan)

- Bound the `spawnSync` call itself (or replace with a bounded `spawn` +
  timer + kill), not a workflow-level CI job timeout — same reasoning as the
  shrink-test fix: fail fast and clearly at the source, not via a blunt
  external timeout.

## Documentation updates

- `v1/docs/operator-runbook.md` — extend the shrink-hang gotcha (or add a
  sibling note) to cover `Test (v2)` hangs on the same unbounded-`spawnSync`
  pattern.
