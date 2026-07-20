---
name: test-daemons-die-with-their-test-runner
---

# Test daemons die with their test runner

Sandbox-unrunnable daemon tests leave detached `daemon-entrypoint.ts` processes alive when an assertion fails or the test runner is killed. Make every daemon spawned by these tests lifecycle-owned by its runner so completed, failed, and interrupted integration runs leave none behind.

## Decisions

- Test-owned daemon PIDs are registered immediately and forcibly reaped during ordinary teardown — rules out relying on the happy-path `stopDaemon` call.
- A test-owned daemon exits when its launching test process disappears — rules out `afterEach` as sufficient protection for abrupt runner death.
- Production daemons remain independent of the CLI process that launches them — rules out applying test-runner lifetime semantics to normal daemon starts.
- Verification covers both ordinary test completion and forced launcher termination — rules out claiming interrupt safety from teardown-only coverage.
- Only daemon-test leak guidance is removed when shipped — rules out deleting the unrelated `ignore-term.sh`/`hang-agent.sh` fixture stopgap.

## Acceptance criteria

- [ ] A completed or assertion-failed sandbox-unrunnable daemon test leaves no daemon it spawned alive.
- [ ] Killing the launching test process leaves no `daemon-entrypoint.ts` process it spawned alive.
- [ ] Normal production daemon startup remains detached and survives launcher exit.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — require spawned test daemons to be reaped on normal and abrupt runner exit.
- `v2/docs/v1-behaviors.md` — record integration-test child-process lifecycle behavior.
- Operator runbooks — remove only a daemon-test leak stopgap if one exists when implemented; none exists in the current tree.

## Prerequisites
