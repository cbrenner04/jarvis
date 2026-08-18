---
name: contention-safe-heavy-test-scheduling
---

# Contention-Safe Scheduling For Heavy Test Files

## Prerequisites

## Surface

Test-suite runner (`scripts/run-v2-tests.ts`, `scripts/test-slice.ts`).

## Problem

- Socket/timing/subprocess-heavy v2 test files pass alone but fail under the concurrency CI actually uses: `v2/src/execution/workflow-runner.test.ts` tips over the agent per-file wall clock (`error: "agent" test run timed out or was killed on file …`) and `v2/src/daemon/daemon-resume.test.ts` produced 106 failures under concurrent load on 2026-08-17, red-gating unrelated PRs and `main`.
- `isLoadSensitive`/`LOAD_SENSITIVE_FILES` already exists as a no-co-runner lane but lists only two files, and nothing tells an author when a file must join it, so the class keeps growing back into the pool.

## Behavior

- The runner schedules every audited socket/agent-heavy v2 test file with no co-runners in either direction, and the per-file agent budget carries a stated margin over the slowest such file's loaded runtime.
- Lane membership is declared in one auditable place, each entry naming the observed failure, and covers the files found by an audit of `v2/src/daemon/**` plus `v2/src/execution/workflow-runner.test.ts`.

## Decisions

- Extend the existing `isLoadSensitive`/`LOAD_SENSITIVE_FILES` seam rather than adding a second scheduling concept; rules out a parallel lane mechanism with its own semantics.
- Size the per-file budget from the slowest audited daemon file's measured loaded runtime plus a stated margin — `workflow-runner.test.ts` is the deliberate outlier `workflow-runner-test-concurrent-load-isolation` brings inside this budget by splitting it, so its current over-budget runtime does not anchor the number; rules out bumping `SUPPORTED_HEALTHY_FILE_BUDGET_MS` to whatever makes today's timeout stop firing.
- Keep aggregate `bun run test` wall clock within the documented regression bar, or re-measure and update that bar in this change; rules out an unbudgeted lane that silently doubles suite time.
- Membership is an operator policy list, not ready-gate repair time; rules out the gate mutating lane membership to go green.

## Required verification

- A runner test pins that each audited heavy file runs with no co-runner in either direction, against an injected spawn that records overlap.
- A test pins the per-file agent budget against the margin rule so lowering it below the documented slowest-file runtime turns red.
- Aggregate `bun run test` wall clock is measured and compared against the documented bar.

## Documentation updates

- `v2/docs/test-writing.md` — the concurrency contract: lane membership rule (when a file must join rather than run in the default pool), the agent per-file budget and its margin, and the refreshed aggregate wall-clock figures.
