---
name: split-sandbox-test-targets
---

# Split the test suite into sandbox-safe and sandbox-off targets

## Problem

`bun run test` runs every test, including the 20 `*.sandbox-unrunnable.test.ts`
files that spawn real subprocesses (git, agent CLIs, `gh`). One subprocess-spawning
file forces the whole suite sandbox-off, so the ~1650 safe tests lose isolation
alongside the ~20 that genuinely need it.

## Direction

Partition the suite into two named targets:

- `test` runs the full suite **excluding** `*.sandbox-unrunnable.test.ts` — runnable
  fully in-sandbox.
- `test:sandbox-off` runs **only** the `*.sandbox-unrunnable.test.ts` subset.

Together they must cover exactly what the old single `test` target covered — no test
silently dropped. Unsandboxed runners (CI, sandbox-off operators) still run everything
by running both targets.

## Prerequisites

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the new `test` / `test:sandbox-off` partition
  (this changes existing `bun run test` behavior).
