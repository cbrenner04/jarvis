---
name: bound-shrink-sandbox-unrunnable-stalls
---

# Bound shrink sandbox-unrunnable stalls to test failures

## Problem

`v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` can hang the CI `Test`
step instead of failing fast when one of its real git subprocesses or imported
idle-hang fixtures stalls.

## Direction

Characterize the shrink-file stall path enough to harden it, then make every
subprocess and hang fixture it owns fail within a bounded time and reap cleanly.

The observable result is: a stalled shrink sandbox-unrunnable case exits as a
failing test with bounded cleanup, and CI no longer waits indefinitely on that
file.

## Decisions

- Fix the shrink test and its owned fixture wiring — rules out masking the hang with a workflow-level CI timeout.
- Bound every real git subprocess on this path — rules out bare `execSync` calls that can block the file synchronously forever.
- Reap all hang-fixture children on this path even on failure — rules out relying on process exit or best-effort `afterEach` cleanup alone.
- Land the defensive bound even if the exact CI trigger stays unpinned — rules out waiting for a deterministic reproducer before removing the latent hang.

## Documentation updates

- `v1/docs/operator-runbook.md` — known gotcha and retry guidance for transient `*.sandbox-unrunnable.test.ts` CI stalls, updated to the post-fix behavior.
- `v2/docs/v1-behaviors.md` — shrink sandbox-unrunnable stalls fail boundedly instead of hanging the test job.

## Prerequisites
