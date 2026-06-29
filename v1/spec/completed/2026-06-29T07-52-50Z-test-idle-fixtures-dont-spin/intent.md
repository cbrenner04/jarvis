---
name: test-idle-fixtures-dont-spin
---

# Test idle fixtures don't spin

Idle/no-output sandbox-unrunnable fixtures currently model silence with `while true; do :; done`, burning a core while waiting for the watchdog.

## Decisions

- Idle fixtures block without output instead of busy-looping - rules out hot loops as the idle-agent model.
- Scope is test fixtures only, not production watchdog behavior - rules out changing timeout semantics to hide fixture cost.

## Out of scope

- Production watchdog/orphan-reaping behavior.
- Operator process-kill policy.

## Documentation updates

- None required; this is test-fixture internals only.

## Prerequisites

- Watchdog/idle behavior is covered by sandbox-unrunnable tests that spawn real helper processes.
