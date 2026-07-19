---
name: daemon-tests-await-observable-state
---

# Daemon tests await observable state

## Problem

Agent-runnable daemon tests use fixed delays as synchronization. Their outcomes therefore depend on scheduler and machine speed even when the behavior under test is correct.

## Decisions

- Wait for the asserted workflow state, prompt, event, or completion condition; rules out fixed-delay synchronization.
- Use injected clocks or pollers when elapsed time is the behavior under test; rules out real-clock timing in agent-runnable tests.
- Keep irreducible real-clock coverage only in marked sandbox-unrunnable tests with rationale; rules out silently exempting daemon tests from the test-writing contract.
- Enforce the rule with a static regression guard over agent-runnable `v2/src/daemon/**/*.test.ts` and `v2/src/execution/**/*.test.ts`: reject `Bun.sleep` and direct timer-backed promise waits; rules out new fixed-delay synchronization while permitting bounded condition polling.

## Out of scope

- Changing daemon workflow production semantics.
- Removing polling that observes a real condition under a bound.

## Acceptance criteria

- The guard fails on a fixed-delay wait in the covered agent-runnable daemon/workflow test surface and passes bounded condition polling.
- A regression test in `v2/src/execution/workflow-runner.test.ts` fails before the change when review completion is inferred from step 0 rather than review-step evidence.
- Agent-runnable daemon/workflow tests do not use fixed sleeps to wait for asynchronous work.
- Daemon tests pass independently of ordinary scheduler speed differences.

## Documentation updates

- `v2/docs/test-writing.md` — distinguish bounded condition polling from sleep-as-wait and state the daemon-test rule.
- `v2/docs/operator-runbook.md` — record the deterministic daemon-test workflow rule.
- `v1/docs/operator-runbook.md` — remove the recovered macOS/Linux race warning.

## Prerequisites
