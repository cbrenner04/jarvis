# The ready gate's shared wall clock turns a slow suite into a phantom red gate

## Problem

`bun run ready` spends **one 10-minute budget across every step**, and the aggregate test suite
alone takes ~9 minutes. When the budget runs out the child tree is killed and `ready` exits `124` —
which the implement run cannot distinguish from a failing test, so it records `ready_gate_repair`
and hands a **phantom red gate** to the repair agent. The agent then edits code that was never
broken.

Three compounding causes:

1. **The deadline is a total, not per-step.** `scripts/ready.ts:263` computes
   `remainingMs = max(0, deadlineMs - elapsedMs)`, so `check`, `typecheck`, `install`, tests, and
   `lint:md` all share `DEFAULT_TIMEOUT_MS = 10 * 60 * 1000` (`ready.ts:7`). A ~9-minute suite
   leaves ~1 minute for everything else.
2. **The flake-retry spends the same budget.** `ready.ts:351-354` re-runs the *entire* failed test
   step with `serialElapsed`. A flaky file at minute 5 leaves the retry 5 minutes to do a 9-minute
   job, so the retry is guaranteed to be killed rather than to answer the question.
3. **Exit `124` is reported as a test failure.** `isGenuineTestFailure` (`ready.ts:328-331`) already
   distinguishes a timeout kill for the *retry* decision, but the code still propagates as a gate
   failure to the caller.

Tests are **not** CPU-saturating: `scripts/run-v2-tests.ts:58` runs `spawnSync("bun", ["test", file])`
one file at a time in a `for` loop. The gate is latency-bound. Concurrency makes the deadline
likelier to bite; it is not the cause.

## Evidence

2026-07-25, spec `20260724T225946Z-write-loop-progress-extended-iteration-wall` (PR #2121). This is
the only spec of the session touching `shared/**`, which the scope classifier maps to all three test
slices; every v2-only spec scoped to `test:v2` and gated fine.

```console
ready: test step failed (code 2); retrying
ready: retry failed (code 2)
ready: …still running bun run test (585s)
ready: deadline exceeded after 600000ms; killing child tree
error: script "test" was terminated by signal SIGTERM (Polite quit request)
error: script "ready" exited with code 124
```

The run recorded `{"kind":"ready_gate_repair","attempt":1,"gateExitCode":1}`, then attempt 2, and
burned two ~12-minute repair iterations. **The same gate, re-run by hand on an idle machine at the
same commit, passed green — full aggregate, 0 failures.** The code was never broken.

The flake that started it is a real-clock race in `v2/src/daemon/daemon-lifecycle.test.ts`
(`captures a real child's stdout into logPath`, 500 ms readiness bound): observed 2/23 failing under
load, 23/23 green three times in a row idle. That file is byte-identical on `main` and the branch.
See `real-clock-races-slip-past-the-determinism-guard`.

## Decisions

- A timeout kill (`124`) must reach the implement run as retryable infrastructure failure, not as a
  red gate; the repair path must not be entered and no agent iteration may be spent. Rules out the
  observed `gateExitCode: 1` laundering, which costs two full repair iterations per occurrence.
- **Each step gets its own deadline**, sized to what that step does; the shared wall clock is
  removed as the binding constraint. Rules out one number covering a seconds-long `lint:md` and a
  ~9-minute test step. This is the missing middle bound: the v2 runner already has a per-*file*
  timeout (`PER_FILE_TIMEOUT_MS`, floored at `SUPPORTED_HEALTHY_FILE_BUDGET_MS = 180_000`), and
  `ready` has a total — nothing is sized to the step.
- **Retain a total ceiling as a backstop, not as the normal bound.** Per-step budgets alone make the
  worst case their sum, with nothing stopping a pathological run from holding the machine. Same
  shape as the write loop's progress-extended wall plus hard ceiling (#2121) — reuse that pattern
  rather than inventing a second one. Rules out both a single shared budget and an uncapped
  per-step model.
- The flake-retry runs on a **fresh step budget**, which falls out of per-step deadlines; a retry
  that cannot finish answers nothing. Rules out charging the retry to the first attempt's remainder,
  which is what made the observed failure deterministic.
- Per-step budgets must exceed the measured worst-case scope (`shared/**` → all three slices) with
  real headroom, and an exhausted budget must name the step and the time it was allotted. Rules out
  a bare `deadline exceeded` with no attribution.
- Do not fix this by raising `JARVIS_READY_TIMEOUT_MS` alone. It is honored (`parseTimeout`,
  `ready.ts:53`) and — unlike `JARVIS_READY_TIER` — is not stomped by `ready-finalize.ts:171`, so it
  is already reachable from the daemon environment; but a larger budget hides the phantom-red
  laundering instead of removing it. Rules out an env-only fix.
- Out of scope: making the suite faster, and the underlying `daemon-lifecycle` real-clock flake.

## Acceptance criteria

- [ ] A test drives a ready gate whose test step is killed by the deadline and asserts the implement
      run records a retryable infrastructure outcome — not `ready_gate_repair`, and with no agent
      iteration consumed; it fails against the pre-fix code, which reports `gateExitCode: 1`.
- [ ] A test asserts a genuinely failing test step still enters the repair path, so the discrimination
      is real in both directions; inverting the timeout guard fails one of the two.
- [ ] A test asserts each step is bounded by its own budget: a step that overruns is killed while a
      later step still receives its full budget; the pre-fix shared wall clock fails it.
- [ ] A test asserts the flake-retry runs with a fresh step budget, not the first attempt's
      remainder; the pre-fix shared-budget behavior fails it.
- [ ] A test asserts the total ceiling still terminates a run whose per-step budgets would otherwise
      sum past it; removing the ceiling fails it.
- [ ] Deadline-exceeded output names the step that exhausted the budget and the time it was allotted.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `124` gate exit is a budget kill, not a red gate;
  how to tell them apart, and that a `shared/**` diff pulls in all three slices.
- `v2/docs/test-writing.md` — the gate budget the aggregate suite must fit inside.

## Prerequisites

None.
