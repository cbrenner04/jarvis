---
name: deflake-watchdog-descendants-alive-test
---

# De-flake the watchdog_descendants_alive test via the process-table DI seam

## Problem

`watchdog_descendants_alive` in `v1/test/run.test.ts` passes in isolation but flakes under
`bun run test` (full `--parallel` suite). It depends on real spawn/reap timing under parallel
load, so the descendant-alive assertion races. This is the one test blocking the parked
`test-suite-audit-and-refactor` run.

## Direction

Apply the #15 process-table DI seam already used to stabilize the reap/watchdog timing tests
(`2026-06-20T21-30-42Z-stabilize-flaky-process-timing-tests`): inject the process table the
watchdog reads so descendant-alive state is deterministic instead of timing-dependent. Preserve
the assertions (`watchdog_descendants_alive=true`/`false`, exit reason `watchdog-iteration-timeout`).

## Out of scope

- The broader test-suite audit/refactor — its own spec; this removes only the one blocker.
- Resuming that parked audit run — an operator action on an existing spec, not authored work.
- General mid-work flake resilience — tracked separately as [[flaky-serial-retry-agent-mid-work-runs]].

## Verification

- `bun run test` (full parallel suite) is green, repeatably — not just the test in isolation.

## Documentation updates

- None beyond the test file; the audit spec carries its own doc updates.

## References

- `v1/test/run.test.ts` (the `watchdog_descendants_alive` tests).
- `v2/spec/completed/2026-06-20T21-30-42Z-stabilize-flaky-process-timing-tests/01-stabilize-run-watchdog-timing-tests.md` (DI-seam pattern to reuse).

## Prerequisites

- The watchdog reads descendant liveness through an injectable process-table seam (the #15 DI pattern is implemented for run-watchdog timing tests).
