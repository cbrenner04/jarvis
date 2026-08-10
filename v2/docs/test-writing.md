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

## Prompt changes

When a registered `prompts/**` artifact changes, its scoped test must render the prompt through its production renderer and assert the rendered output. Reading or asserting raw template text does not cover the change and ready finalization fails with `missing-render-coverage`.

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

`runV2TestFiles` (`scripts/run-v2-tests.ts`) spawns each file asynchronously and captures its stdout/stderr instead of inheriting the parent's stdio; each file's captured output is flushed as one contiguous block, headed by a `--- <file> ---` line, as soon as that file settles — including output captured before a kill, which is never dropped. Per-file timeout is classified from the timer that fired the kill, not inferred from `signal`/`status` on the result, so an externally-delivered `SIGKILL` within budget is reported as an ordinary failure rather than a timeout.

Every non-zero, timed-out, signaled, or null-status settlement also emits one `JARVIS_READY_FAILING_TEST_FILE` record to stderr. The marker prefixes JSON containing the repo-relative `path` and ready-step `attemptId`; healthy files emit none. This applies in both the concurrent pool and isolated load-sensitive phase. The ready gate supplies the attempt through `JARVIS_READY_ATTEMPT_ID`; direct runner invocations use `standalone`.

### Bounded concurrency pool

`runV2TestFiles` runs files under a bounded pool of concurrent `bun test <file>` children instead of one at a time. `test:v2` and `test:integration:v2` inherit the pool because both route through this shared seam; `scripts/run-tests.ts`'s integration phase is routed onto the same seam (not a separate `spawnSync` loop) so it gets the same per-file timeout and captured-output attribution. Every file in the integration slice matches the `.sandbox-unrunnable.test.ts` suffix convention, so `isLoadSensitive` routes all of them to the isolated one-at-a-time phase — `test:integration:v2` inherits the seam's mechanics but does not gain wall-clock benefit from pooling. `test:cost` (`scripts/measure-test-cost.ts`) stays serial — it is a measurement tool, not the gate.

The concurrency limit defaults to half of `availableParallelism()` (floor 1) — `defaultConcurrency` in `scripts/run-v2-tests.ts`. This is deliberately headroom-driven, not tuned to the pooled phase's performance knee: the pooled phase plateaus around 4 concurrent files (bounded by the slowest pooled file, `v1/test/run.test.ts` at 108.8s), well below half of an 18-core box's parallelism. The extra headroom guards against self-saturation, the condition under which known load-dependent test flakes reproduce — trading a wider margin for less contention risk, not chasing peak throughput.

`resolveConcurrency` resolves the limit with this precedence: an explicit override argument wins over the `JARVIS_TEST_CONCURRENCY` env var, which wins over the derived default. A malformed or `0` env value falls back to the derived default rather than throwing.

Wall clock: theoretical floor is `158.7 + max(pooled / N, 108.8)` ≈ 267s (158.7s is the isolated sandbox-unrunnable phase from subspec 02, 108.8s is the pooled-phase floor set by `v1/test/run.test.ts`). Measured on quiet operator hardware (2026-07-26, five consecutive `bun run test` runs): 321-330s, mean 326s — subspec 01's ≤320s target was a pre-measurement projection against the theoretical floor and is superseded by this distribution; **326s (mean, 321-330s range)** is the current aggregate `bun run test` wall clock, with **≤335s** as the regression bar. For comparison, the pre-change aggregate `bun run test` was 697s (2026-07-26, before this concurrency change) and a separate, differently-measured `bun run test:cost` pass was 574.4s (2026-07-26, see "Measured aggregate cost" below) — each figure labeled by the command and date that produced it.

Stop semantics under the pool: a plain (non-timeout) failure stops every mode, including `agent`, from admitting new files — files already in flight are still awaited and reported, not discarded. A timeout does not stop `agent` mode, which keeps admitting new files and reports every timed-out file by name; a timeout in any other mode stops admission the same as a plain failure. Each child's per-file timeout is armed independently at its own spawn, so a slow sibling never shortens another file's budget. Output blocks print in settle order, not roster order, once files can overlap.

### Load-sensitive isolation

Some files are known to flake under concurrent load though they pass reliably alone — a test that is green idle and red under load is a candidate for this list. `isLoadSensitive` in `scripts/test-slice.ts` covers two declaration mechanisms: every `*.sandbox-unrunnable.test.ts` file by default, plus an exported explicit `LOAD_SENSITIVE_FILES` list for files outside that suffix convention. Each explicit-list entry carries a comment naming the observed failure. Changes to `LOAD_SENSITIVE_FILES` are operator decisions about suite execution policy — not ready-gate repair time. This predicate is distinct from `isSandboxUnrunnable` (the slice-partition key deciding which `test:*` script runs a file) — a suffix-matched file is always both, but a file can be load-sensitive without being sandbox-unrunnable.

`runV2TestFiles` excludes `isLoadSensitive` files from the bounded pool and runs them one at a time after the pool has fully drained, with no co-runners in either direction — the pool finishes before an isolated file starts, and no other file starts while it runs. Mode semantics are unchanged for the isolated phase: `agent` mode keeps admitting past an isolated file's timeout and stops on a plain failure, matching pooled-file behavior; every other mode stops admitting further files after either.

### Ready-gate step budgets

`bun run ready` (`scripts/ready.ts`) arms each step with its own fixed budget, not a shared remainder of one deadline. `TEST_STEP_BUDGET_MS` is **15 minutes** (900000ms) and `JARVIS_READY_TIMEOUT_MS`'s default `DEFAULT_TIMEOUT_MS` is **30 minutes** — both were sized against the pre-concurrency 697s aggregate `bun run test` and are **deliberately unchanged here**: the concurrent runner's measured 326s mean (see "Wall clock" above) only widens their headroom, and re-sizing a gate budget is its own reviewable risk. Re-sizing is tracked as a follow-up: [cbrenner04/jarvis#2181](https://github.com/cbrenner04/jarvis/issues/2181). Each scoped test step (`test:v1`, `test:v2`, `test:integration:v2`, …) is its own step with this same budget — a `shared/**` diff that scopes to all three slices runs three separate steps, and it is the **run ceiling**, not this per-step budget, that must have enough headroom to cover their sum. Non-test steps get smaller fixed budgets (`INSTALL_STEP_BUDGET_MS`, `CHECK_STEP_BUDGET_MS`, `TYPECHECK_STEP_BUDGET_MS`, `LINT_MD_STEP_BUDGET_MS`). A step's budget does not shrink because prior steps ran long — it is armed fresh, capped only by `min(stepBudgetMs, ceilingMs -
runElapsedMs)`.

`JARVIS_READY_TIMEOUT_MS` (default `DEFAULT_TIMEOUT_MS`, 30 minutes) is the **run ceiling only** — a backstop over the whole `bun run ready` invocation, not a per-step timeout. It is sized so a flake-retry still arms a fresh full test budget: with the current measured aggregate `bun run test` at 326s (mean, 2026-07-26) and the other steps seconds each, a run with one serial test retry is ~12 minutes — well inside the unchanged 30-minute ceiling (previously ~24 minutes against the 697s pre-change figure). It deliberately does not cover the budget worst case (~38 minutes, every step consuming its full budget plus a retry); if the suite grows into that range the retry's budget is clamped by the ceiling and the kill is attributed to "run ceiling" in stderr. When the ceiling binds before a step's own budget would, the kill is attributed to "run ceiling" in stderr instead of "step budget". When a step budget itself is the binding limit, raise the relevant `*_STEP_BUDGET_MS` constant in `scripts/ready.ts` — there is no per-step env knob. Update `TEST_STEP_BUDGET_MS` (and `DEFAULT_TIMEOUT_MS` accordingly) if measured full-suite duration drifts — and re-run `bun run
test:cost` to refresh the per-file totals below ("Measured aggregate cost") in step.

Sources: `scripts/ready.ts`, `v1/test/ready-script.sandbox-unrunnable.test.ts`

Each ready-step attempt ends with one `JARVIS_READY_STEP_COMPLETED` stderr boundary. Its JSON contains `stepId`, distinct `attemptId`, command identity, and numeric terminal `status`. A retry keeps the step identity and gets a new attempt identity; non-test steps emit completion boundaries but no failing-file records.

For a failed ready invocation, select its terminal failed completion boundary. Only failing-file records correlated to that test step's final attempt are attributable. A recovered retry, a later non-test failure, or missing completion boundary is unattributed. Validate repo-relative paths, normalize them, then deduplicate exact paths within that selected attempt only, preserving deterministic first-seen settlement order.

### Per-file test cost reporter

`bun run test:cost` (`scripts/measure-test-cost.ts`) measures the aggregate roster (or file arguments passed on the command line) by spawning each file's `bun test <file>` separately and reporting, per file and as roster totals: wall clock, the in-file execution time from `bun test`'s own summary line, and the **residual** between them (`wallClockMs - inFileMs`). The residual is process spawn and runtime boot, plus teardown — not module resolution, transpile, or import side effects, which bun's own summary-line elapsed already includes (measured residual is flat, 5-11ms, across files ranging from 37ms to 108.8s wall clock); this command does not conclude what fraction a shared-process runner would eliminate. A file whose summary line doesn't parse, or that exceeds the per-file timeout (`SUPPORTED_HEALTHY_FILE_BUDGET_MS`), is reported `unparsed`/`timedOut` with its wall clock counted but excluded from the in-file/residual totals — an excluded file's wall clock is rolled into a separate `excludedWallClockMs` total, not into the residual. It does not affect `bun run test`.

#### Measured aggregate cost (2026-07-26, operator hardware)

One `bun run test:cost` run over the full aggregate roster (229 files, 0 unparsed, 0 timed out) measured: wall clock 574.4s, summed in-file execution 573.2s, residual 1.2s (0.2% of wall clock). Residual is uniform per-file (5-11ms each), not one outlier. Top 5 files by residual: `v1/test/run-command-linked-subspec-and-pr.test.ts` (11ms), `v1/test/plan-delete-ready-intent-command.test.ts` (9ms), `v1/test/plan-disposable-worktree-predicate.test.ts` (9ms), `v1/test/run.test.ts` (9ms), `v2/src/cli.test.ts` (9ms) — these differences are within bun's own reporting resolution (durations print to 4 significant figures, ±10ms of quantization at 108s, which is also why one file's residual rounds to `-0ms`), so this ranking is noise, not signal.

This measurement does not reconcile with the intent's motivating datapoint (v2 slice: 84s wall vs 11.7s reported test time, "~86% is spawn"): that figure came from one `bun test` invocation batching 85 files' worth of tests into a single summary line, not from summing each file's own summary line the way `test:cost` does here. The two numbers measure different quantities and this measurement does not settle whether a shared-process runner would recover the difference.

This is a separate, slower-and-more-lenient measurement pass, not a `bun run test` transcript: `test:cost` captures each file's output instead of inheriting it, and does not stop on a non-zero exit or timeout, so its 574.4s total will not exactly reproduce the current 326s (mean) `bun run test` runner-path wall clock recorded above — both figures, plus the 697s pre-change baseline, are kept side by side, each labeled by which command and date produced it.

Raw output: [`v2/docs/test-cost-baseline.txt`](test-cost-baseline.txt). Re-run `bun run test:cost` and update both the baseline file and these figures when the aggregate roster changes materially.

## Shared socket fixtures

Socket-backed v2 tests import `canUseUnixSockets` from [`v2/src/testing/unix-socket.ts`](../src/testing/unix-socket.ts). Register socket-dependent tests with `test.skipIf(!canUseUnixSockets(), ...)` — do not use silent-return skip wrappers that report pass. Guard hooks with `canUseUnixSockets()`. Emit file-local stderr gated on `socketProbeErrored` when the suite needs operator-visible skip context — the shared probe does not write on failure.

Use for any v2 test binding or connecting to a Unix socket under `tmpdir()`, subject to the round-trip allowance defined in "Do not reimplement production logic in test doubles" below. `daemon-start-list.test.ts` predates that cap and is not a general blessed example.

Generic daemon run-control request helpers (`mockWriteLoopInput`, `startRun`, `listRuns`) live in [`v2/src/testing/run-control.ts`](../src/testing/run-control.ts). They take an `IpcClient` and optional `WriteLoopInput` overrides — request-shaping, not assertion-specific setup. They are socket-only by construction: use them within the retained round-trip allowances (the `ipc.test.ts` transport suite, the 1-2-per-handler-set smokes, `.sandbox-unrunnable` smokes) — not as the default for run-control-protocol tests generally. Default to calling the handler factory's returned handlers directly, in-process; see the worked example below.

Shared write-execution fixtures (`createJarvisHome`, `createFakeWithExternalWorktree`, `trackedTempRoots`) live in [`v2/src/testing/write-fixtures.ts`](../src/testing/write-fixtures.ts). Use them for tests exercising write-loop and write behaviors to unify temporary directory management, Jarvis-home creation, and fake worktree state.

The `setupSandboxGitRepo` fixture lives in [`v2/src/testing/sandbox-git-repo.ts`](../src/testing/sandbox-git-repo.ts) and is **sandbox-only** — it spawns real `git` commands and must only be imported from `.sandbox-unrunnable.test.ts` files. Agent-runnable tests must not import it.

The daemon smoke test (`v2/src/daemon/daemon.sandbox-unrunnable.test.ts`) demonstrates the minimal real-process fixture. Detached daemons spawned by sandbox-unrunnable tests must use `createTestDaemonLifecycle`: it registers the PID before readiness can fail, force-reaps it after completed or failed tests, and opts it into launcher-death reaping for interrupted test runners. Production daemon launches must not opt in.

Pure in-memory logic (e.g., `WorktreeOwnershipRegistry`) belongs in agent-runnable tests (`daemon-registry.test.ts`) without `.sandbox-unrunnable` markers, even when moved from a real-process context. Use DI seams to inject the registry instance under test with mocked state, not real OS operations.

## Deterministic daemon and execution tests

Agent-runnable daemon and execution tests (`v2/src/daemon/**/*.test.ts` and `v2/src/execution/**/*.test.ts` excluding `.sandbox-unrunnable.test.ts`) must not use direct timer-backed waits. **Bounded condition polling** is allowed; **sleep-as-wait** is forbidden.

- **Bounded condition polling** (allowed): a while loop that polls a condition until it becomes true, with either a deadline bound (`Date.now() < deadline`) or a signal bound (`!signal?.aborted`). Example:
  ```typescript
  const deadline = Date.now() + 5_000;
  while (!done() && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  ```
  The loop will terminate either when the condition is true or when the deadline passes, guaranteeing deterministic test behavior.

- **Sleep-as-wait** (forbidden): a direct timer-backed wait like `await new Promise((resolve) => setTimeout(resolve, 100))` or `Bun.sleep(100)` used as a synchronization mechanism without a bounded condition. This makes tests depend on real-clock timing and scheduler load.

- **Timer-callback guards**: extract guards inside `setTimeout` or `setInterval` callbacks into pure exported predicates testable in both directions without a real timer, so mutation verification and this determinism guard are both satisfiable.

A static guard (`scripts/guard-deterministic-daemon-tests.ts`) verifies this rule and runs as part of `bun run check`. Tests that require irreducible real-clock timing (e.g., testing timeout enforcement) must be moved to `.sandbox-unrunnable.test.ts` files and run only in the integration suite outside the agent sandbox.

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

## Worked example: timer-callback guard extraction

When a guard inside a `setInterval` callback changes, extract it into a pure exported predicate and test that predicate directly — no `Bun.sleep`, timer-backed `Promise`s, or waiting for the interval to fire (determinism guard), and both truth directions on the changed line (mutation verifier).

**Production instance:** `shouldShutdownNow` in [`daemon.ts`](../src/daemon/daemon.ts), pinned by [`daemon-retire-superseded.test.ts`](../src/daemon/daemon-retire-superseded.test.ts).

**Teaching fixture:** [`timer-callback-guard-fixture.ts`](../src/testing/timer-callback-guard-fixture.ts) — pure `shouldStopPolling` plus `registerStopPoll` for the `setInterval` wiring. Inverting `!hasPendingWork` to `hasPendingWork` fails the first predicate case; see [`timer-callback-guard-fixture.test.ts`](../src/testing/timer-callback-guard-fixture.test.ts).

## Guard-inversion evidence

Guard-inversion ACs require a **source mutation on the real guard** and a **comment checkpoint on the pinning test** naming that mutation (documents what to flip so the pin turns RED; not a substitute for mutating the guard).

Injected write-step rules carry the guard-inversion evidence contract and invert-hook prohibition into agent prompts — necessary but not sufficient to stop production invert hooks. Static enforcement runs under `bun run check` via `scripts/guard-production-test-flags.ts`.

Forbidden production invert hooks: `setInvert*ForTest` exports, `invert*ForTest` module variables, `invert*` function parameters, `invert*ForTest` type members.

## Test doubles must not call production behavior

Test fixtures and mocks under `v2/src/testing/**` must never compute their responses by calling the production behavior they stand in for. Such calls turn the double into a self-referential assertion that checks implementation against itself rather than catching behavioral drift or misuse.

### Rejected pattern

```typescript
import { dispatchWorkflowStep } from "../workflow/dispatcher.ts";

export function createWorkflowStepDouble() {
  const response = dispatchWorkflowStep(input); // ← violation: test double calls production
  return { ...response, mockedField: true };
}
```

### Allowed patterns

**Type-only imports from production** are safe and do not require allowlisting:

```typescript
import type { WorkflowStep } from "../workflow/types.ts";

export function createDouble(): WorkflowStep {
  return { kind: "step", data: {} };
}
```

**Value imports of constants or utilities** that are never *called* are safe:

```typescript
import { DEFAULT_TIMEOUT } from "../constants.ts";

export function createDouble() {
  return { timeout: DEFAULT_TIMEOUT };
}
```

**Allowlisted production entry points** are permitted when the test needs production behavior (e.g., daemon lifecycle management or state-store access for hermetic integration). The allowlist is maintained in `scripts/guard-test-double-production-calls.ts`:

```typescript
import { startDaemon, isProcessAlive } from "../daemon/daemon-lifecycle.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { main } from "../cli.ts";

// These are allowlisted and may be called to set up integration fixtures
const daemon = await startDaemon(socketPath);
const isAlive = isProcessAlive(daemon.pid);
const store = openStateStore(dbPath);
const exitCode = await main(["--help"]);
```

### How to extend the allowlist

If a new production entry point must be called from a test double (e.g., for hermetic integration fixtures), add it to the `ALLOWLIST` set in `scripts/guard-test-double-production-calls.ts` with a reason:

```typescript
const ALLOWLIST = new Set([
  "../daemon/daemon-lifecycle.ts#startDaemon",
  // Add new entry as "../path/to/module.ts#exportName" with a reason in a comment above
]);
```

A static guard (`scripts/guard-test-double-production-calls.ts`) verifies this rule and runs as part of `bun run check`.

## TUI test strategy

The TUI phase cannot assert painted ink output in CI — headless runners do not observe rendered terminal frames ([#2417](https://github.com/cbrenner04/jarvis/issues/2417), [#2418](https://github.com/cbrenner04/jarvis/issues/2418)). Rendered-frame assertions also risk local-green / CI-red asymmetry when ink layout or terminal capabilities differ between environments.

Substitutes for rendered-output assertions:

- **Pure layout functions** — region geometry and display-width row composition (`tui-shell-layout.ts`): per-row supported-width floors, full-cluster fit, right-to-left cluster-atom degradation, and grapheme-safe label ellipsis/clipping, in place of the retired fixed-column grid and width-tier table.
- **Injected input hook** — keybinding and focus behavior without asserting painted frames.
- **Production monitor state** — poll/dispatch outcomes and selection state the shell wires to ink.

See [operator-runbook.md § Gate trust](operator-runbook.md#gate-trust) for what the v2 gate covers.

## Out of scope

- **One-size-fits-all rewrites** — do not mechanically convert every primitive match. First classify it: `already-deterministic`, `refactor`, or `marked-exception`.
