---
name: concurrent-load-suite-margin-check
---

# Pin The Suite's Concurrency Margin

## Prerequisites

- The suite runner schedules audited socket/agent-heavy test files with no co-runners and declares lane membership in one auditable place.
- The agent per-file wall-clock budget is documented with a stated margin over the slowest audited file's loaded runtime.
- The audited daemon test files own collision-free per-test socket/tmp/db state and pass under concurrent load.
- The execution-loop workflow test files complete inside the per-file agent budget with margin under concurrent load.

## Surface

Test tooling (`scripts/`); operator/scheduled invocation, not `.github/workflows/ci.yml`, per the decision below.

## Problem

- Nothing pins that the suite passes repeatedly under the concurrency CI actually uses; the 2026-08-17 failure rate moved from ~4% to ~44% purely with load, and `scripts/guard-deterministic-daemon-tests.ts` cannot see it because each offending test is individually deterministic.
- Without a repeated-run margin check, a newly added heavy file silently re-approaches the edge and the red-gating toil returns.

## Behavior

- A repeated-run check executes the suite through the real runner scheduling across a pinned number of repeats and fails when any repeat fails or when a file's observed runtime exceeds the documented budget margin, naming that file.

## Decisions

- Drive the check through the production runner seam so it exercises real scheduling and real contention; rules out a mocked check that fakes the load it exists to detect.
- Pin repeat count and margin as named constants with a stated rationale; rules out an unpinned "run it a few times by hand" convention.
- Run the check as an operator/scheduled invocation rather than on every PR unless its measured wall clock fits the gate; rules out multiplying per-PR CI time to prove a rare condition.

## Required verification

- The check turns red when a file's observed runtime crosses the margin, pinned against injected runtimes.
- One recorded run of the check over the real suite reports pass with its observed worst-case per-file runtime.

## Documentation updates

- `v2/docs/test-writing.md` — how to run the margin check, what its repeats and margin mean, and what to do when it names a file.
- `v2/docs/operator-runbook.md` — when the operator runs the check and how to act on a named file.
