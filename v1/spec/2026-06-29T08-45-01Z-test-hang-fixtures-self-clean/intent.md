---
name: test-hang-fixtures-self-clean
---

# Test hang fixtures self-clean

Hang fixtures spawned by sandbox-unrunnable watchdog/idle tests can survive abnormal test exit as orphans in temp dirs, including `jarvis-run-*` and `jarvis-patch-review-parent-*`.

## Decisions

- Hang helpers terminate on their own after a bounded lifetime or parent-death check - rules out unbounded orphan survivors.
- Deferred to first consumer: exact lifetime bound — pin when a caller needs it.
- Tests clean up spawned helper process trees in teardown - rules out relying on OS cleanup after thrown tests, watchdog kills, or interrupts.
- Scope is test fixture lifecycle only, not production orphan reaping - rules out changing the production watchdog/reaper path.

## Out of scope

- Production watchdog/orphan-reaping behavior.
- Operator process-kill policy.

## Documentation updates

- `v1/docs/operator-runbook.md` - remove any stopgap warning about leaked `*-hang.sh` fixture orphans once fixture self-cleaning lands.

## Prerequisites

- Watchdog/idle behavior is covered by sandbox-unrunnable tests that spawn real helper processes.
