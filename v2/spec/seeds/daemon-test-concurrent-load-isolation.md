---
name: daemon-test-concurrent-load-isolation
---

# Daemon Tests Survive Concurrent Load

## Prerequisites

- The suite runner schedules audited socket/agent-heavy test files with no co-runners and declares lane membership in one auditable place.
- The agent per-file wall-clock budget is documented with a stated margin over the slowest audited file's loaded runtime.

## Surface

Daemon (`v2/src/daemon/**/*.test.ts`, shared fixtures under `v2/src/testing/**`).

## Problem

- `v2/src/daemon/daemon-resume.test.ts` passes 0-fail across four straight isolated runs (~6s) but produces 106 failures when run concurrently with other heavy files under load; per-test temp state is keyed on `process.pid`/`Date.now()`, which is not collision-free, and the 30s per-test default timeout is reachable under contention.
- Sibling heavy daemon files (`pipeline-execution.test.ts`, `daemon-wait-run-completion.test.ts`, `daemon-pipeline-observation.test.ts`, `daemon-start-list.test.ts`) share the same socket/tmp/subprocess shape, so a one-file patch leaves the next file flaking.

## Behavior

- Each audited daemon test owns collision-free socket/tmp/db state that is torn down after it, and the audited files pass with every assertion intact when run concurrently on a loaded machine.

## Decisions

- Isolate through a shared per-test isolation fixture in `v2/src/testing/**` whose paths are unique by construction; rules out clock- or pid-derived uniqueness and rules out each file inventing its own scheme.
- Share fake-agent/daemon fixtures where the subprocess is incidental to the assertion; rules out keeping per-test spawns that only shape argv.
- No test deleted or skipped: test count and asserted behaviors match the pre-fix files; rules out trimming coverage to fit the clock.
- Splitting a file into sibling files is allowed when every assertion survives; rules out keeping one file parked at the per-file budget edge.

## Required verification

- The audited daemon files pass repeated runs executed concurrently with each other on a loaded machine, not only in isolation.
- A count/inventory comparison against the pre-fix files pins unchanged coverage.

## Documentation updates

- `v2/docs/test-writing.md` — the per-test isolation requirement for socket/tmp/db state, the shared fixture that provides it, and its place in the determinism smell checklist.

## Reprioritization note (2026-08-29)

Demoted from ready-intents: verify still needed — the #2900 no-co-runner lane has held since 2026-08-18, and the planned workflow-runner module/test split ([[split-workflow-runner-resume-machines]]) reworks this surface. Re-scope or reap at re-triage.
