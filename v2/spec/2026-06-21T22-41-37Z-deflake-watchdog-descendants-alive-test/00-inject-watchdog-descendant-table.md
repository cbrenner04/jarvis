# Inject the watchdog descendant-liveness process table

## Problem

The watchdog descendant-liveness snapshot reads the **real** OS process table:
`snapshotWatchdogDescendantsAlive` (`v1/src/modes/patch/iteration.ts:101`) calls the
module-level `listProcesses()` directly, then `collectSubtree(pgid, procs)`. Under the full
`--parallel` suite, whether a spawned descendant is listed at the instant the watchdog fires
races with spawn/reap timing, so the `watchdog_descendants_alive=true`/`false` assertions in
`v1/test/run.test.ts` flake even though they pass in isolation. This is the one blocker for the
parked `test-suite-audit-and-refactor` run.

The #15 DI pattern (`listProcesses` injection + `collectSubtree`) already exists in
`reap.ts` for `DescendantTracker`; the watchdog snapshot path just never routed through it.

Affected tests (assert the snapshot result, currently read from the real table):

- `watchdog timeout kills SIGTERM-ignoring grandchildren and records pgid telemetry` — asserts `watchdog_descendants_alive=true`.
- `watchdog timeout records watchdog_descendants_alive false for agent-only stall` — asserts `watchdog_descendants_alive=false`.

## Decisions

- Stabilize by injecting the process table the watchdog snapshot reads (seam threaded from `RunCommandOptions` through `killWatchdogWithDescendants` into `snapshotWatchdogDescendantsAlive`), reusing the #15 `listProcesses`/`collectSubtree` pattern. Rules out the timeout-widening / retry / serialization mechanisms the prior stabilize spec deferred and this intent rejects.
- The seam must let a test force the snapshot to true or false **deterministically without knowing the agent's dynamically-allocated pid** (the snapshot's `rootPid`/pgid is assigned at spawn). Rules out a bare `() => ProcInfo[]` provider that cannot produce a descendant of an unknown `rootPid` — pass `rootPid` to the provider (or otherwise let the test name a descendant of it).
- Production behavior unchanged: with no override the snapshot still calls the real `listProcesses()`. Rules out altering watchdog descendant detection in production to serve a test.
- Keep the real agent spawn and the real grandchild-kill / early-interruption (`elapsedMs <= 7200`) assertions; only the descendant-alive snapshot becomes injected. Rules out replacing the integration test with a unit test (drops the kill + telemetry-plumbing coverage) and rules out leaving the snapshot reading the real table (the race).
- Test-only changes plus the inert seam; no other watchdog/run logic changes. Rules out folding in the broader suite audit (its own spec).
- Scope to the two descendant-alive assertions named above; extend the same seam to the `early-output-stall` test's secondary `watchdog_descendants_alive=false` assertion only if it shares the same real-table race. Rules out an open-ended "any watchdog test" sweep.

## Task checklist

- [ ] Add an injectable process-table seam to the watchdog snapshot path (default = real `listProcesses()`), threaded from `RunCommandOptions` to both `killWatchdogWithDescendants` call sites.
- [ ] Rewire the two descendant-alive tests in `run.test.ts` to inject a deterministic table yielding the asserted true/false.
- [ ] Confirm the affected tests pass in isolation and inside the full `bun run test` run.

## Acceptance criteria

- [ ] The watchdog descendant-liveness snapshot reads its process table through an injectable seam threaded from `RunCommandOptions`; absent the override, the production path still calls the real `listProcesses()` (watchdog behavior unchanged).
- [ ] The `watchdog_descendants_alive=true` grandchildren test and the `watchdog_descendants_alive=false` agent-only-stall test inject a deterministic table; their `watchdog_descendants_alive` (`true`/`false`) and `exit_reason: "watchdog-iteration-timeout"` assertions are preserved and no longer depend on real spawn/reap timing.
- [ ] The grandchildren test's real grandchild-kill and early-interruption (`elapsedMs <= 7200`, `watchdog_pgid` present, `last_output_age_ms=null`) assertions stay green (behavior unchanged by the seam).
- [ ] No change to watchdog/run implementation behavior under `v1/src` beyond adding the inert test seam.
- [ ] `bun run typecheck` and `bun run test` (full `--parallel` suite) pass, repeatably.

## Documentation updates

- None. Production watchdog behavior is unchanged (test-only seam, default = real `listProcesses()`), so `v2/docs/v1-behaviors.md` needs no update.
