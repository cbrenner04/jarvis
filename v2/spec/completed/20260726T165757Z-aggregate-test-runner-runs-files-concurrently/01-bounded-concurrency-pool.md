# 01 - Bounded-concurrency pool over the async seam

## Problem

Subspec 00 makes `runV2TestFiles` async with captured, attributed output but still runs one file at
a time. `bun run test:cost` over the full roster (2026-07-26, 229 files, `v2/docs/test-writing.md`,
raw output `v2/docs/test-cost-baseline.txt`) measured 574.4s wall clock against 573.2s summed
in-file execution — the cost is genuine test execution running serially on an 18-core box, not spawn
overhead (residual 1.2s, 0.2%). This subspec adds the bounded pool that lets independent files
overlap.

`scripts/run-tests.ts:29-36` runs the integration phase (`test:integration:v2`, ~158.7s of the 574s
roster) in its own `for` loop with a bare `spawnSync` — outside `runV2TestFiles` entirely, so it has
no timeout enforcement and no injected seam today. Left alone, "concurrency lands in the shared seam"
would be true for `test:v2` and false for `bun run test`, which is what the intent targets.

The wall-clock floor is not the slowest file. Sandbox-unrunnable files are serialized by subspec 02's
isolation rule (158.7s); the pooled remainder is 407.9s with a slowest pooled file of 108.8s
(`v1/test/run.test.ts`). The floor is approximately
`158.7 + max(407.9 / N, 108.8)` ≈ **267s**, and the pooled phase stops improving once N reaches
about 4 — a slowest-pooled-file plateau, not a resource ceiling. Half of `availableParallelism()` (9
on the 18-core reference box) is past that knee.

## Decisions

- Concurrency lands in the shared `runV2TestFiles` seam, so `test:v2` and `test:integration:v2`
  inherit it, and `scripts/run-tests.ts`'s integration loop is rerouted onto the same seam instead of
  its own bare `spawnSync`. Rules out leaving the integration phase on a separate uninstrumented
  path — that path is 28% of aggregate wall clock and is exactly where an unnamed load-dependent
  integration failure was already observed.
- The integration phase gains per-file timeout enforcement and captured, attributed output by
  routing through the seam, but does not gain wall-clock benefit from pooling: every file in that
  phase is scheduled load-sensitive-by-convention under subspec 02's suffix rule and runs isolated,
  same as today's effective serialization. Rules out claiming a speedup there that the isolation rule
  would immediately take back.
- Concurrency comes from N overlapping `bun test <file>` children under a bounded pool, not from one
  `bun test --parallel <files…>` process. Rules out the in-process batching the v1 agent slice uses
  (`scripts/run-v1-tests.ts`): no per-file timeout, no per-file attribution, no way to isolate a
  single load-sensitive file — all three are required here.
- Default limit is derived from `availableParallelism()` and reserves headroom (half the reported
  parallelism, floor 1); an explicit argument or the `JARVIS_TEST_CONCURRENCY` env var overrides it,
  with the explicit argument winning when both are set. A malformed or `0` env value falls back to
  the derived default rather than throwing. Rules out unbounded fan-out and cores-minus-one:
  self-saturation is the exact condition under which the three known load-dependent failures
  reproduce. The half-parallelism default is chosen for saturation headroom, not to chase the pooled
  phase's frontier — the pooled phase plateaus around N≈4, well below half of 18 cores; the headroom
  is deliberately generous rather than tuned to the knee, since the flakes it guards against are the
  more expensive failure mode.
- Concrete wall-clock target: aggregate `bun run test` at or below 320s (down from 697s), giving
  margin above the ≈267s theoretical floor for run-to-run variance. Rules out "materially below
  697s", which a 650s run would satisfy without buying anything real.
- `v1/test/run.test.ts` (108.8s, the pooled-phase floor-setter) is not added to the load-sensitive
  list and runs pooled like any other file. Rules out isolating it by default: doing so would push
  the serial tail from ≈267s toward ≈376s (158.7 + 108.8 + max(299.1/N, next-slowest)) for a file
  with no recorded load-dependent failure — the trade is not worth taking pre-emptively. If it later
  proves load-sensitive, it is added to subspec 02's explicit list like any other discovered flake.
- The per-file timeout stays 180s (`SUPPORTED_HEALTHY_FILE_BUDGET_MS`) and is armed per child at its
  own spawn, independent of pool occupancy. Rules out one deadline covering the pool, under which a
  slow sibling consumes another file's budget.
- Stop semantics under concurrency: a plain (non-timeout) failure stops every mode, including
  `agent`, from starting new files — matching subspec 00's preserved fail-fast contract — while
  in-flight children are awaited and their results reported, not discarded. A timeout does not stop
  `agent` mode: it continues starting new files and reports every timed-out file by name; a timeout
  in a non-`agent` mode stops the same as a plain failure. Rules out a shape that loses a failing or
  timed-out file's identity, and rules out re-litigating subspec 00's fail-fast-on-failure scope.
- `aggregateExitCode` derives from whether any result failed or timed out, not from the last settled
  result. Rules out the `results.at(-1)` logic, which is meaningless once settle order is
  nondeterministic under a pool.
- Output block order is settle order, not roster order (carried from subspec 00's per-file
  attribution, now visibly nondeterministic once files overlap). Rules out buffering the whole run
  to restore roster order, which would withhold all output until the end of a multi-minute run.
- Concurrent files can collide on shared resources beyond CPU — fixture paths, `$TMPDIR`,
  `~/.jarvis`, ports — a failure class serial execution never exposed. Subspec 02's load-sensitive
  list is the absorber: a file discovered to flake this way under the pool is added there, the same
  path used for CPU-load flakes. Rules out inventing a second declaration mechanism for
  resource-collision flakes.
- The source-literal parity assertions in `test/test-slices.test.ts` (`spawn("bun", ["test", file]`,
  `timeout: PER_FILE_TIMEOUT_MS`, `if (mode !== "agent")`, `continue`) are updated to the concurrent
  runner's equivalents. Rules out deleting them: they are the cross-runner policy guard.

## Acceptance criteria

- [x] The runner executes independent pooled files concurrently under a bounded worker limit: a test
      drives a fixture roster through the injected spawn seam, records observed overlap, and asserts
      at most N files are in flight at once; it fails against subspec 00's still-serial runner (which
      never exceeds 1).
- [x] The limit defaults to a value derived from `availableParallelism()` with reserved headroom
      (half, floor 1): a test asserts the derivation for a stubbed parallelism value.
- [x] An explicit override wins over `JARVIS_TEST_CONCURRENCY`, which wins over the default; a
      malformed or `0` env value falls back to the derived default: a test asserts all three
      precedence cases.
- [x] A limit of 1 reproduces serial execution: a test asserts observed overlap never exceeds 1 and
      files settle in roster order.
- [x] `scripts/run-tests.ts`'s integration phase runs through the shared concurrent seam instead of
      its own `spawnSync` loop: a test asserts an integration-phase file is subject to the same
      per-file timeout and captured-output attribution as a `test:v2` file.
- [x] A file exceeding its own timeout is killed and reported by name while its pooled co-runners
      keep running to completion: a test drives a timing-out fixture alongside healthy pooled files
      and asserts both the named timeout diagnostic and the co-runners' results.
- [x] A slow co-runner does not shorten another file's budget: a test asserts each child is armed
      with the full per-file timeout independently of sibling runtime.
- [x] `agent` mode continues past a timed-out file and reports every timed-out file across concurrent
      workers by name; a plain (non-timeout) failure stops every mode, including `agent`, from
      starting new files while still reporting results of files already in flight: a test asserts no
      post-failure start and that in-flight results survive, matching subspec 00's preserved
      fail-fast contract under a pool.
- [x] `aggregateExitCode` is non-zero when any result failed or timed out regardless of settle order:
      a test asserts a healthy file settling last does not mask an earlier failure, and it fails
      against the pre-change last-result logic.
- [x] Roster equivalence holds — `test/test-slices.test.ts` stays green, including its policy-parity
      assertions updated to the concurrent runner's literals.
- [x] Inverting each added guard fails a test: inverting the pool's admission check (allowing an
      extra in-flight file), the non-`agent`/plain-failure stop check (starting new files after a
      failure), and the per-file timeout arming each break at least one test; the stop-check negative
      case asserts the suppressed effect — that no further spawn occurs — rather than only that the
      run exits non-zero.
- [x] `bun run check` is green, including `scripts/guard-deterministic-daemon-tests.ts`.

## Documentation updates

- `v2/docs/test-writing.md` — the bounded-pool concurrency model, the default derivation and the
  `JARVIS_TEST_CONCURRENCY` override with its precedence and malformed-value fallback, why the
  default is headroom-driven rather than knee-tuned, the ≈267s theoretical floor and the 320s
  concrete target, the corrected stop/continue semantics per mode, and that `test:v2` /
  `test:integration:v2` (including the rerouted integration phase) inherit the pool while `test:cost`
  stays serial.
- `v2/docs/v1-behaviors.md` — update the runnable-test-commands entry (execution model is now a
  bounded pool, integration phase routed through the shared seam), the per-file-timeout-floor
  invariant entry (timeout is now per concurrent child), and the scoped-CI-vs-aggregate parity entry.
