# Own test daemon lifecycles

Detached daemons started by integration tests can outlive failed or interrupted
test runners. Give test launches normal-teardown reaping and an abrupt-parent-death
backstop without changing production daemon independence.

## Decisions

- Register the PID at the spawn boundary before readiness polling — rules out registration only after `startDaemon` resolves, which leaks on startup failure.
- Expose test ownership through an explicit `startDaemon` option and test fixture — rules out inferring ownership from test environment or argv.
- Pass the launching test PID to the daemon and make only opted-in daemons watch that PID — rules out production daemons inheriting launcher lifetime.
- Force-reap every registered live test daemon during teardown — rules out graceful IPC shutdown as the cleanup guarantee.
- Verify parent-death and production-detachment behavior with real subprocess launchers in a sandbox-unrunnable regression test — rules out mocked process probes as interrupt coverage.
- Leave operator runbooks unchanged because no daemon-test leak stopgap exists — rules out removing the unrelated `ignore-term.sh` or `hang-agent.sh` fixture guidance.

## Tasks

- Add a shared test-daemon fixture that opts into parent ownership, registers spawned PIDs immediately, and force-reaps survivors during teardown.
- Add the opt-in ownership signal at daemon launch and an entrypoint watcher that exits when the recorded owner PID disappears.
- Migrate every sandbox-unrunnable test that spawns the detached daemon entrypoint to the shared fixture.
- Add real-process regression coverage for normal cleanup, failed launch/test paths, forced launcher termination, and production launcher exit.
- Update `v2/docs/test-writing.md` with the normal and abrupt cleanup contract for spawned test daemons.
- Update `v2/docs/v1-behaviors.md` with the integration-test child-process lifecycle behavior and production boundary.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-test-lifecycle.sandbox-unrunnable.test.ts` (or an equivalently named integration test) fails against the pre-fix lifecycle and proves that ordinary teardown and an assertion-failed launcher leave no registered daemon alive.
- [x] The same regression test kills a launcher and proves its opted-in `daemon-entrypoint.ts` child exits without test teardown running.
- [x] The same regression test proves a production-mode daemon remains alive after its launcher exits, then explicitly reaps it.
- [x] Every sandbox-unrunnable test launch of the detached daemon entrypoint uses the lifecycle-owned fixture; PID registration occurs before readiness polling can fail.
- [x] `v2/docs/test-writing.md` requires test-spawned daemons to be reaped after completed, failed, and interrupted runs; `v2/docs/v1-behaviors.md` records the opt-in test lifecycle and production independence.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — test-daemon normal and abrupt cleanup contract.
- `v2/docs/v1-behaviors.md` — integration-test ownership and production-detachment boundary.
- Operator runbooks — no change; no daemon-test leak stopgap exists.
