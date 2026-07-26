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

## Blocker

Neither prerequisite is confirmed in committed code. `scripts/run-v2-tests.ts` today spawns files serially via `spawnSync` with `stdio: "inherit"` — no async bounded concurrency, no per-file capture, no grace-delay worker resolution. Both prerequisites describe the target state of `v2/spec/20260726T165757Z-aggregate-test-runner-runs-files-concurrently`, whose subspecs are still unchecked (plan merged, implementation not landed).

This intent and that spec touch the same seam (the aggregate runner) — per spec-guidance's "plan same-seam siblings serially," they must not be planned/run in parallel off the current base. Hold this intent until `aggregate-test-runner-runs-files-concurrently`'s implementation merges, so the prerequisites become real. Do not draft a spec from this intent before then.
