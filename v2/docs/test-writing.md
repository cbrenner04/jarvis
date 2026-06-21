# Test-writing conventions

## Agent-runnable tests (default)

An **agent-runnable test** is the default test class, expected to pass in the coding agent's sandbox without special environment setup. Agent-runnable tests:

- **Must not spawn real OS processes** — use dependency injection (DI) to accept process-table providers and kill handlers instead of calling `execSync`, `spawn`, etc.
- **Must not depend on wall-clock or scheduler timing** — use injected clocks and polling functions instead of real `sleep()` calls or timeouts that depend on system load.
- **Must use dependency-injection seams** — constructor parameters or test fixtures that supply injected process tables, clocks, or pollers so the behavior under test is deterministic.

These tests are the default because they are:
- Deterministic and reproducible across environments
- Sandbox-runnable (available in the coding agent's restricted execution context)
- Fast (no real process overhead or sleep delays)

## Real-process / real-clock tests (marked exception)

Tests that require real OS processes or wall-clock timing are **marked exceptions**, not the default. Such tests must:

1. Declare themselves sandbox-unrunnable with an explicit filename marker: use a `.sandbox-unrunnable` infix in the filename. Example: `foo.sandbox-unrunnable.test.ts`.
2. Carry a comment at the top explaining why real OS seams are necessary (e.g., "exercises the actual `execSync` and process reaping logic that must work on real systems").

Real-process tests will need to exist going forward — the actual `execSync` and process-reaping logic (`v1/src/modes/patch/reap.ts`) should have test coverage as seams are converted. Existing real-process tests that predate this convention are out of scope to convert; new seams should be covered with the DI pattern from the start.

## Worked example: DescendantTracker injection pattern

The `DescendantTracker` class in [`v1/src/modes/patch/reap.ts`](../../../v1/src/modes/patch/reap.ts) demonstrates the agent-runnable pattern:

```typescript
// Constructor accepts optional DI seams (defaults to real OS calls)
constructor(deps?: {
  listProcesses?: () => ProcInfo[];
  kill?: (pid: number, signal: NodeJS.Signals) => void;
})
```

Tests pass a fixed, mutable process table and a recording kill to exercise the reap logic deterministically:

```typescript
let table: ProcInfo[] = [proc(1000, 1, 1000), proc(2000, 1000, 2000)];
const killed: number[] = [];
const tracker = new DescendantTracker({
  listProcesses: () => table,
  kill: (pid) => killed.push(pid),
});

// Simulate state changes by mutating the table
tracker.poll(1000);
table = [proc(2000, 1, 2000)];
expect(tracker.reap()).toBe(1);
expect(killed).toEqual([2000]);
```

The behavior under test (capture descendants, kill survivors by PID+identity, prune gone/reused PIDs) is pure and does not depend on real OS scheduling. See [`v1/test/modes/patch/reap.test.ts`](../../../v1/test/modes/patch/reap.test.ts) for the full test suite.

## Out of scope

- **Automated enforcement** — linting or review automation to catch violations is deferred to a future enforcement spec. The convention rests on authors reading this document and choosing DI seams in advance.
- **Converting existing tests** — this convention applies to new tests. Incremental conversion of existing process-spawning tests that can't run in the sandbox inherits the `DescendantTracker` pattern as separate effort.
