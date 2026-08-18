---
name: workflow-runner-test-concurrent-load-isolation
---

# Workflow-Runner Tests Fit The Budget Under Load

## Prerequisites

- The suite runner schedules audited socket/agent-heavy test files with no co-runners and declares lane membership in one auditable place.
- The agent per-file wall-clock budget is documented with a stated margin over the slowest audited file's loaded runtime.
- A shared per-test isolation fixture for socket/tmp/db state exists in `v2/src/testing/**` and is used by the audited daemon test files.

## Surface

Execution loop (`v2/src/execution/workflow-runner.test.ts` and its siblings).

## Problem

- `v2/src/execution/workflow-runner.test.ts` is one ~216-test file running ~2 minutes against the agent per-file wall clock; on a slow or loaded runner it tips into an agent-test timeout, observed red-gating two live PRs and post-merge `main` on 2026-08-17, each passing an unchanged CI re-run.
- Its per-test temp workspaces and fake-agent spawns fan out across the whole file, so its loaded runtime scales with contention rather than staying inside the budget.

## Behavior

- The execution-loop workflow tests complete inside the per-file agent budget with the stated margin when the machine is loaded, with every assertion preserved.

## Decisions

- Split the file into sibling files by behavior area and/or share workspace fixtures to cut per-test fan-out; rules out leaving one file at the budget edge and raising the timeout to cover it.
- Reuse the shared per-test isolation fixture rather than adding an execution-loop-specific one; rules out a second isolation scheme for the same problem.
- No test deleted or skipped: test count and asserted behaviors match the pre-fix file; rules out trimming coverage to fit the clock.

## Required verification

- The execution-loop workflow test files pass repeated runs under concurrent machine load with measured runtime inside the budget margin.
- A count/inventory comparison against the pre-fix file pins unchanged coverage.

## Documentation updates

- `v2/docs/test-writing.md` — how an execution-loop test file stays inside the per-file budget (fixture sharing, fan-out limits, when to split a file) rather than joining the no-co-runner lane.
