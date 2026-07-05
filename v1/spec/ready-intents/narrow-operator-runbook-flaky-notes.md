---
name: narrow-operator-runbook-flaky-notes
---

# Narrow operator-runbook flaky real-subprocess-test gotchas

## Problem

`v1/docs/operator-runbook.md` accumulated several "known flaky real-subprocess
test" gotchas (`ci-shrink-test-hang`, `triage-merge-classify-load-flake`,
`v2-test-runner-unbounded-spawn`) from sessions chasing CI-only hangs. Once
the mockable-subprocess conversion has removed real subprocess spawns from
the affected suites, these gotchas are moot and should be dropped or
narrowed rather than left as stale operator guidance.

## Scope

- Review each of the three gotchas against the converted test suites.
- Drop any gotcha whose failure mode no longer exists (the suite no longer
  spawns a real subprocess that could hang).
- Narrow (rather than drop) any gotcha still partially applicable to a
  remaining justified real-subprocess test.

## Documentation updates

- `v1/docs/operator-runbook.md` — drop/narrow the three gotchas per above.

## Prerequisites

- v1 patch-mode shrink tests use the mocked subprocess boundary.
- v2 tests use the mocked subprocess boundary.
- v1 CLI and command tests use the mocked subprocess boundary.
