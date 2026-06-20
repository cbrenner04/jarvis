---
name: stabilize-flaky-process-timing-tests
---
# Stabilize load-sensitive process-timing tests

**Scope.** Make the process-spawning/timing tests deterministic under the full `bun test --parallel` suite so they stop spuriously blocking runs. Test-side changes only; the code under test is correct.

## Problem

A small set of process-spawning/timing tests fail nondeterministically under the full parallel suite on a loaded machine but pass in isolation. Because the agent runs the full suite per subspec and the completion gate runs it again, a spurious flake reads as a red gate — the run churns or (correctly, per discipline) raises a `## Blocker`, halting otherwise-sound work.

Observed flaky tests (verified pass in isolation; flake a different subset each parallel run):
- `v1/test/modes/patch/reap.test.ts` — 2 `DescendantTracker` tests (descendant process tracking).
- `v1/test/run.test.ts` — watchdog-timing tests asserting `watchdog_descendants_alive` / `last_output_age_ms` (e.g. "watchdog timeout kills SIGTERM-ignoring grandchildren and records pgid telemetry").

This session, these false-blocked `split-god-modules` subspecs 00 and 02 with bogus blockers; only luck-of-the-draw clean runs let G/H/J pass.

## Desired behavior

The identified tests pass deterministically whether run in isolation or inside the full parallel suite under load, without losing the behavior they cover. A green isolated run and a green full-suite run agree.

## Decisions

- Fix the tests' timing assumptions, not the watchdog/reaping implementation — the code under test is correct and stays unchanged. Rules out editing `reap.ts`/watchdog code to paper over a test-timing issue.
- Preserve the assertions' intent (descendant-alive detection, pgid telemetry, age recording). Rules out deleting or weakening coverage to make red go green.
- Do not widen global suite tolerance or disable parallelism suite-wide. Rules out masking by raising every test's timeout or dropping `--parallel`. Per-test stabilization only.
- Mechanism is determined at implementation against the observed flake cause (process-poll timing under CPU contention): acceptable approaches are relative/poll-until assertions with a bounded deadline, a retry-on-timing wrapper scoped to these tests, or serializing just the process-spawning tests outside the parallel pool. Pin the exact mechanism when the flake cause is reproduced.

## Acceptance signals

- The named `reap.test.ts` and `run.test.ts` process-timing tests pass in isolation and in the full `bun run test` run, repeatably.
- No change to `v1/src/modes/patch/reap.ts` or the watchdog implementation; only test files (and any test-only helper) change.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/spec/wip-intents/flaky-process-timing-tests-block-runs.md`: mark resolved / remove once landed.
- `v2/docs/v1-behaviors.md`: only if a test-only helper changes an observable testing contract (likely none).

## Out of scope

- The no-progress stop and completion check:fix loop that *also* surface flakes as red gates — separate completion-robustness intents.
- Rewriting watchdog/reaping behavior.
