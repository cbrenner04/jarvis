# Guard deterministic daemon tests

## Problem

- Test cleanup alone does not prevent fixed-delay synchronization from returning.
- Durable test and operator guidance does not distinguish bounded condition polling from sleep-as-wait or reflect the recovered daemon race.

## Decisions

- Statically guard agent-runnable `v2/src/daemon/**/*.test.ts` and `v2/src/execution/**/*.test.ts`; rules out relying on review memory.
- Reject `Bun.sleep` and direct timer-backed promise waits while allowing bounded condition polling; rules out banning observable polling with fixed-delay synchronization.
- Exclude marked sandbox-unrunnable tests from the guard; rules out forcing irreducible real-clock coverage into agent routing.
- Run the guard through the repository check gate; rules out an opt-in script that normal verification can skip.

## Work

- Add a focused static guard and unit tests for covered paths, forbidden waits, bounded condition polling, and sandbox-unrunnable exclusions.
- Wire the guard into the standard check command.
- Update durable testing and operator guidance; remove the recovered v1 race warning.

## Acceptance criteria

- [x] The static guard fails for `Bun.sleep` and direct timer-backed promise waits in covered agent-runnable daemon and execution tests.
- [x] Guard tests prove bounded condition polling passes and `.sandbox-unrunnable.test.ts` is excluded.
- [x] The standard repository check runs the guard, and the cleaned covered test surface passes it.
- [x] `v2/docs/test-writing.md` distinguishes bounded condition polling from sleep-as-wait, states the daemon/execution rule, and no longer says automated enforcement is out of scope.
- [x] `v2/docs/operator-runbook.md` records the deterministic daemon-test workflow rule, and `v1/docs/operator-runbook.md` removes the recovered macOS/Linux timing-race warning.

## Documentation updates

- `v2/docs/test-writing.md`
- `v2/docs/operator-runbook.md`
- `v1/docs/operator-runbook.md`
