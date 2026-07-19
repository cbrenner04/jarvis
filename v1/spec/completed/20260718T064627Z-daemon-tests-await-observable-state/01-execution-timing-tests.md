# Make execution timing tests deterministic

## Problem

- Agent-runnable execution tests use real timers to order aborts, watchdogs, and delayed callbacks.
- Those assertions vary with scheduler load even when execution behavior is correct.

## Decisions

- Drive timeout and abort ordering through injected timer or poller seams; rules out real-clock races in agent-runnable execution tests.
- Preserve bounded polling of an asserted condition; rules out treating condition polling as a fixed wait.
- Keep irreducible real-clock coverage only in `.sandbox-unrunnable.test.ts` with rationale; rules out silently exempting execution tests from agent-runnable conventions.

## Work

- Classify direct timer-backed waits in agent-runnable `v2/src/execution/**/*.test.ts` as condition polling, elapsed-time behavior, or fixed-delay synchronization.
- Replace fixed waits and add the minimum deterministic seams needed to order watchdog, abort, and delayed-completion cases.
- Preserve execution runtime behavior and assertion strength.

## Acceptance criteria

- [x] Agent-runnable `v2/src/execution/**/*.test.ts` uses observable-condition polling or injected timing seams instead of direct fixed-delay waits.
- [x] Timeout-versus-abort and delayed-completion cases deterministically control which event wins without scheduler slack.
- [x] Irreducible real-clock execution tests are marked with rationale explaining why.
- [x] Existing `v2/src/execution/**/*.test.ts` stays green; production execution semantics are unchanged.

## Documentation updates

- None; this subspec changes test synchronization only. Enforcement and operator guidance land in subspec 02.
