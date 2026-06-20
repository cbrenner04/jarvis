# Stabilize run watchdog-timing tests

## Problem

In `v1/test/run.test.ts`, the watchdog tests that drive real hanging/stalling shell scripts (busy-loops) under short `iterationTimeoutMs` and then assert `watchdog_descendants_alive` / `last_output_age_ms` telemetry flake under `bun test --parallel` on a loaded machine. The busy-loop scripts plus suite-wide CPU contention perturb spawn, output-age sampling, kill-grace propagation, and elapsed-time bounds, so a descendant the watchdog did reach reads as still-alive (or vice versa) and the assertion fails. They pass in isolation. Named example and same-category tests:

- "watchdog timeout kills SIGTERM-ignoring grandchildren and records pgid telemetry" (`watchdog_descendants_alive=true`, `last_output_age_ms=null`, `elapsedMs <= 7200`).
- "watchdog timeout records last_output_age_ms from early output then stall" (`last_output_age_ms` numeric, `watchdog_descendants_alive=false`).
- "watchdog timeout records watchdog_descendants_alive false for agent-only stall".

The watchdog implementation is correct and must not change. Scope is the `watchdog_descendants_alive` / `last_output_age_ms` timing assertions; any other watchdog test in `run.test.ts` shown to flake from the same process-poll-under-contention cause is in scope, but no behavior-classification test is to be weakened.

## Decisions

- Test-only changes confined to `v1/test/run.test.ts` (and any new test-only helper it imports). Rules out touching the watchdog/run implementation. — the code under test is correct.
- Preserve assertion intent: descendant-alive vs killed detection, `watchdog_pgid` telemetry presence, and `last_output_age_ms` recording each still verify the same behavior. Rules out deleting or weakening coverage to make red go green.
- Reproduce the flake under the full parallel suite under load before choosing the mechanism; pin it to the observed cause. Candidate mechanisms (intent-sanctioned): poll-until-with-bounded-deadline / relative assertions in place of fixed elapsed bounds, a retry-on-timing wrapper scoped to these tests, or serialize just these process-spawning tests outside the parallel pool. Rules out widening the global suite timeout or dropping `--parallel`.
- This subspec also removes the now-resolved wip-intent, completing the flake-stabilization PR. Rules out leaving a stale "blocking runs" intent on disk after the fix lands.

## Task checklist

- [ ] Reproduce the watchdog timing tests flaking under the loaded full parallel suite; confirm green in isolation.
- [ ] Apply the per-test stabilization mechanism to `run.test.ts` only.
- [ ] Confirm the affected tests pass in isolation and inside the full `bun run test` run, repeatably.
- [ ] Remove `v2/spec/wip-intents/flaky-process-timing-tests-block-runs.md` (resolved by this spec).

## Acceptance criteria

- [ ] The watchdog-timing tests in `v1/test/run.test.ts` that assert `watchdog_descendants_alive` / `last_output_age_ms` pass both in isolation and inside the full `bun run test` run, repeatably under load.
- [ ] Their assertion intent is preserved: descendant-alive/killed detection, `watchdog_pgid` telemetry, and `last_output_age_ms` recording each still verify the same behavior (no deleted or weakened checks); no behavior-classification test is loosened.
- [ ] No change to the watchdog/run implementation under `v1/src`; changes are confined to `run.test.ts` and any test-only helper it imports.
- [ ] `v2/spec/wip-intents/flaky-process-timing-tests-block-runs.md` no longer exists.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- Remove `v2/spec/wip-intents/flaky-process-timing-tests-block-runs.md` (the intent it describes is resolved).
- `v2/docs/v1-behaviors.md`: no change — test-only timing changes introduce no observable testing contract.
