---
name: aggregate-timeout-reaps-the-test-process-group
---

# Aggregate timeout reaps the test process group

A per-file timeout in the aggregate v2 test runner must bound the aggregate command, not just the direct child. Today the timeout `SIGKILL`s only the spawned `bun test <file>` PID and resolves the worker after a grace delay; a descendant that outlives that kill and still holds inherited stdout/stderr keeps the runner process alive. An indefinite descendant hangs `bun run test` forever and leaks work into later files.

## Behavior

- Per-file timeout terminates the spawned test process group (or equivalent descendant tree), not only the direct child PID.
- Grace expiry releases captured stdout and stderr so surviving inherited pipe handles cannot hold the aggregate runner open.
- Regression coverage runs the real transport inside a subprocess that creates a descendant surviving direct-parent `SIGKILL` while retaining inherited pipes, and asserts the whole invoking subprocess exits within a short bound. Asserting only on the returned spawn promise is insufficient.
- Preserve per-file output attribution, pre-kill captured output, timer-based timeout classification, bounded concurrency, load-sensitive isolation, and current agent/integration stop semantics.

## Out of scope

- Output-capture size limits and ready-gate budget resizing (issue #2181).

## Documentation updates

- `v2/docs/test-writing.md` — per-file timeout owns the test process group and cannot be held open by descendant pipe inheritance.

## Prerequisites

- The v2 aggregate test runner spawns per-file test processes asynchronously with bounded concurrency and a timer-based per-file timeout.
- Per-file stdout and stderr are captured and attributed per file rather than inherited straight to the terminal.

Both are satisfied on `main` as of #2190: `scripts/run-v2-tests.ts` spawns asynchronously under a
bounded pool (`resolveConcurrency`), captures stdout/stderr per file, and settles a timed-out file
after `child.kill("SIGKILL")` plus a grace delay. The prior `## Blocker` (same-seam hold on
`aggregate-test-runner-runs-files-concurrently`) is cleared — that spec's implementation merged.
