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

Keep a real-process test only when the OS/git/process boundary is the behavior under test. If the subprocess or clock is incidental to the assertion, convert the test to an agent-runnable DI seam instead of keeping a real process.

### v2 run-command routing

- **`bun run test:v2`** — agent-runnable v2 tests only (`v2/**/*.test.ts` except `*.sandbox-unrunnable.test.ts`). This is the sandbox-agent-facing slice.
- **`bun run test:integration:v2`** — v2 `*.sandbox-unrunnable.test.ts` at any depth under `v2/`; runs serially (no `--parallel`). Use outside the coding-agent sandbox.
- **`bun run test`** — aggregate gate; still collects all v2 tests including sandbox-unrunnable files.

The v2 integration slice is derived from the filename convention: a `*.sandbox-unrunnable.test.ts` file automatically routes to the integration slice without requiring edits to the slice-boundary test.

Sources: `package.json`, `scripts/run-v2-tests.ts`, `test/test-slices.test.ts`

## Shared socket fixtures

Socket-backed v2 tests import `canUseUnixSockets` from [`v2/src/testing/unix-socket.ts`](../src/testing/unix-socket.ts). Register socket-dependent tests with `test.skipIf(!canUseUnixSockets(), ...)` — do not use silent-return skip wrappers that report pass. Guard hooks with `canUseUnixSockets()`. Emit file-local stderr gated on `socketProbeErrored` when the suite needs operator-visible skip context — the shared probe does not write on failure.

Use for any v2 test binding or connecting to a Unix socket under `tmpdir()`, subject to the round-trip allowance defined in "Do not reimplement production logic in test doubles" below. `daemon-start-list.test.ts` predates that cap and is not a general blessed example.

Generic daemon run-control request helpers (`mockWriteLoopInput`, `startRun`, `listRuns`) live in [`v2/src/testing/run-control.ts`](../src/testing/run-control.ts). They take an `IpcClient` and optional `WriteLoopInput` overrides — request-shaping, not assertion-specific setup. They are socket-only by construction: use them within the retained round-trip allowances (the `ipc.test.ts` transport suite, the 1-2-per-handler-set smokes, `.sandbox-unrunnable` smokes) — not as the default for run-control-protocol tests generally. Default to calling the handler factory's returned handlers directly, in-process; see the worked example below.

Shared write-execution fixtures (`createJarvisHome`, `createFakeWithExternalWorktree`, `trackedTempRoots`) live in [`v2/src/testing/write-fixtures.ts`](../src/testing/write-fixtures.ts). Use them for tests exercising write-loop and write behaviors to unify temporary directory management, Jarvis-home creation, and fake worktree state.

The `setupSandboxGitRepo` fixture lives in [`v2/src/testing/sandbox-git-repo.ts`](../src/testing/sandbox-git-repo.ts) and is **sandbox-only** — it spawns real `git` commands and must only be imported from `.sandbox-unrunnable.test.ts` files. Agent-runnable tests must not import it.

The daemon smoke test (`v2/src/daemon/daemon.sandbox-unrunnable.test.ts`) demonstrates the minimal real-process fixture: spawn a detached daemon, serve health and status responses over a real socket, gracefully stop, and verify socket unbinds. This is the irreducible test for wire protocols requiring real OS seams.

Pure in-memory logic (e.g., `WorktreeOwnershipRegistry`) belongs in agent-runnable tests (`daemon-registry.test.ts`) without `.sandbox-unrunnable` markers, even when moved from a real-process context. Use DI seams to inject the registry instance under test with mocked state, not real OS operations.

## Determinism smell checklist

Treat these as triage smells for both new tests and existing ones:

- **Real process spawn is incidental**: the test shells out only to inspect argv, cwd, env, retries, or stdout/stderr shaping. Fix by injecting a spawn/process runner seam.
- **Wall-clock or scheduler dependence**: assertions depend on `Date.now()`, `new Date()`, `setTimeout`, `sleep`, elapsed milliseconds, or load-sensitive watchdog slack. Fix by injecting a clock and poller.
- **Ordering / parallelism sensitivity**: the test assumes serial execution, shared mutable globals, or worker timing. Fix by isolating state, removing cross-test coupling, or making sequencing explicit in fixtures.
- **Redundant coverage**: multiple tests assert the same behavior through slightly different setup. Merge or drop the duplicate once one clear assertion path remains.
- **Slow default-suite tests**: nested subprocesses, real sleeps, or large end-to-end flows in agent-runnable files. Move irreducible OS coverage to `*.sandbox-unrunnable.test.ts`; otherwise replace the cost with a seam.
- **Unbudgeted socket round-trip**: a new agent-runnable test gated on `skipIf(!canUseUnixSockets())` is a defect unless it is the `ipc.test.ts` transport suite, a 1-2-per-handler-set round-trip smoke, or a `.sandbox-unrunnable` smoke. Otherwise call the handler factory's returned handlers directly, in-process.

Use this review question set:

- Is a real subprocess required for the behavior being asserted, or is it just a transport detail?
- Could the same assertion be expressed against an injected clock, poller, process table, or runner?
- Does the assertion still pass if the machine is slow, highly parallel, or under scheduler pressure?
- Is another test already proving the same behavior more directly?
- Is the runtime cost justified for the default parallel suite?

## Do not reimplement production logic in test doubles

When an exported production seam can be exercised with injected fakes, call that seam. Do not recreate owned behavior in local doubles, stub handlers, or copied control flow.

**Unit under test:** the exported production unit that owns the behavior (factory, handler set, module function, or class method path the assertion targets).

**Dependencies outside that boundary:** ordinary fakes, spies, and injected fixtures remain valid. Fake the state store, clock, executor, or process table; keep the production orchestration.

### Worked example: daemon run-control handler drift

**Anti-pattern:** reimplementing run-control handler orchestration in test-local stubs when `createRunControlHandlers` already owns it. IPC assertions may pass against the fake handlers while production semantics drift unchecked.

**Expected pattern:** call the exported factory with injected dependency fakes, then invoke the returned handlers directly, in-process — no socket:

```typescript
const handlers = createRunControlHandlers({
  stateStore,
  writeLoopExecutor: fakeExecutor.executor,
  failureReporter: () => {},
});

const response = await handlers.startRun(request);
```

The write-loop executor fake is outside the owned boundary; assertions exercise real handler behavior without a wire round-trip. Tail-stream tests use the same factory-over-fakes pattern with `createTailStreamHandler`, invoking its returned handler directly.

Reserve a real socket round-trip for transport coverage, and put every such test in a `.sandbox-unrunnable` file so the agent slice stays skip-free: the [`ipc.sandbox-unrunnable.test.ts`](../src/ipc/ipc.sandbox-unrunnable.test.ts) transport suite, plus at most 1-2 round-trip smokes per handler set (one budget per exported factory — `createRunControlHandlers` in [`daemon-start-list.sandbox-unrunnable.test.ts`](../src/daemon/daemon-start-list.sandbox-unrunnable.test.ts), `createTailStreamHandler` in [`tui-log-tail-client.sandbox-unrunnable.test.ts`](../src/tui/tui-log-tail-client.sandbox-unrunnable.test.ts)) proving JSON marshaling survives the wire. A `skipIf(!canUseUnixSockets())` gate in a non-suffixed file is a defect: it silently skips in the agent sandbox instead of routing to the integration slice.

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

- **Automated enforcement** — linting or review automation to catch agent-runnable violations or production-logic double drift is deferred to a future enforcement spec.
- **One-size-fits-all rewrites** — do not mechanically convert every primitive match. First classify it: `already-deterministic`, `refactor`, or `marked-exception`.
