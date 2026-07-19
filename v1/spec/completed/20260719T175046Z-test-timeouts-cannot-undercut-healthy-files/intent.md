---
name: test-timeouts-cannot-undercut-healthy-files
---

# Test timeouts cannot undercut healthy files

## Problem

The aggregate runner's fixed per-file timeout drifted below a healthy file's runtime. The emergency increase restores headroom but provides no invariant preventing recurrence.

## Decisions

- Define 180 seconds as the supported healthy-file budget; every per-file hang cutoff for the aggregate roster must be at least that budget.
- Apply the same bound wherever CI and ready run the same file; rules out machine-dependent pass/fail differences hidden by runner choice.
- Do not validate the invariant with load-sensitive wall-clock assertions in agent-runnable tests; rules out replacing runner flakiness with test flakiness.

## Out of scope

- Eliminating the overall ready-gate deadline.
- Changing integration-test sandbox routing.

## Acceptance criteria

- `scripts/run-v2-tests.test.ts` contains a regression test that fails before the change when a per-file cutoff is below the 180-second supported healthy-file budget.
- A supported healthy test file cannot be killed by a per-file cutoff below 180 seconds.
- A hung file remains bounded and its failure identifies the file.
- Aggregate and scoped execution apply the same per-file bound to each shared file.
- Temporary incident warnings are removed after the protected contract is documented.

## Documentation updates

- `v2/docs/operator-runbook.md` — document the permanent hang bound and remove the temporary red-main gate gotcha; retain the unrelated red-gate repair-loop gotcha.
- `v2/docs/v1-behaviors.md` — record the permanent test-bound behavior.
- `v1/docs/operator-runbook.md` — remove the recovered-incident warning.

## Prerequisites

- Aggregate and scoped CI suites share one file-roster and execution contract.
- V1 run-command tests are partitioned so no healthy file depends on the 180-second allowance.
