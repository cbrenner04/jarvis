---
name: aggregate-test-runner-runs-files-concurrently
---

# Aggregate suite runs independent files concurrently without reintroducing load-dependent flakes

## Problem

`runV2TestFiles` (`scripts/run-v2-tests.ts:55`) spawns `bun test <file>` once per file in a serial
`for` loop. The aggregate `bun run test` takes 697 s.

**The spawn-count premise is refuted.** `bun run test:cost` over the full roster (2026-07-26,
229 files, recorded in `v2/docs/test-writing.md`, raw output `v2/docs/test-cost-baseline.txt`)
measured:

| measure | value |
| --- | --- |
| wall clock | 574.4 s |
| summed in-file execution | 573.2 s |
| residual (spawn + runtime boot) | **1.2 s (0.2%)** |

Residual is flat at 5–11 ms per file, confirmed independently (`/usr/bin/time -p bun test <file>`
reports `real 0.04` against bun's own `43ms`). Batching files per process would recover about one
second. The superseded intent `aggregate-test-runner-cuts-spawn-count` targeted that ~0.2%; it is
replaced by this one.

The real cost is that 574 s of genuine test execution runs **serially** on an 18-core machine. The
lever is concurrency, not spawn reduction.

**Concurrency is the exact thing that has already broken this suite**, so it is not a free win. Three
load-dependent failures were observed on 2026-07-26, each passing on a quiet machine and failing
with three concurrent implement runs saturating the box:

- `v2/src/daemon/daemon-workflow-start.test.ts` — "eagerly provisions the managed worktree before
  dispatch for a linked implement step" asserted 3 provisioning calls, got 2 under load; 26/26 pass
  idle.
- One `test:integration:v2` file failed under load, all green idle (same commit, back-to-back runs).
- `daemon-lifecycle … captures a real child's stdout into logPath` — known to fail under load,
  passes 23/23 idle.

A runner that adds concurrency turns these from an occasional operator surprise into the default
condition of every gate run.

## Decisions

- The target is wall clock, not process count. Rules out any framing or acceptance criterion in
  terms of spawns eliminated — that quantity is measured at 0.2% and is not worth buying.
- Concurrency is bounded and configurable, not unbounded fan-out over the roster. Rules out
  `Promise.all` over 229 files, which would oversubscribe the box and maximize exactly the
  load-dependent failures named above.
- Files that are known or declared load-sensitive keep their isolation from added load. How they are
  declared (filename convention, explicit list, or a per-file marker) is deferred to first consumer,
  but the three files named in the Problem section must be covered from the start. Rules out shipping
  concurrency that makes a known flake routine.
- Success requires demonstrated stability, not just a faster number: the aggregate must pass
  repeatedly under the new runner. Rules out accepting a fast run that flakes one time in five.
- Per-file timeout enforcement, the `SUPPORTED_HEALTHY_FILE_BUDGET_MS` floor, and
  `validatePerFileTimeout`'s rejection of an undercutting timeout all survive. A per-file timeout
  must remain per-file under concurrency — a file's budget cannot be consumed by a sibling's runtime.
  Rules out buying speed by loosening the timeout.
- `agent` mode still continues past a timed-out or failed file and reports every failure by name;
  non-`agent` modes still stop. Under concurrency, "stop" means no new files are started and
  in-flight ones are settled — not that already-running work is silently discarded. Rules out a
  shape that loses a failing file's identity.
- Roster equivalence holds: the aggregate runs exactly the union of the scoped slices
  (`test/test-slices.test.ts` stays green).
- Output stays attributable: with several files writing at once, each file's failure output must
  remain identifiable as that file's. Rules out interleaving inherited stdio into an unreadable mix.
- Out of scope: ready-gate budget and ceiling values (they follow from the new wall clock, and are
  changed separately once it is measured); the `.sandbox-unrunnable.test.ts` separation, which stays
  as-is.

## Acceptance criteria

- [ ] The runner executes independent files concurrently under a bounded worker limit; a test drives
      a fixture roster and asserts at most N files run at once, and fails against the pre-change
      serial runner.
- [ ] The concurrency limit is configurable and defaults to a value derived from available cores
      rather than a hard-coded constant; a test asserts the default derivation and that an explicit
      override is honored.
- [ ] Load-sensitive files are excluded from concurrent execution and run isolated; a test asserts
      the three files named in the Problem section are scheduled without co-runners, and inverting
      that exclusion fails it.
- [ ] A file exceeding its own timeout is still killed and reported by name while its co-runners
      continue; a test drives a timing-out fixture alongside healthy ones and asserts both.
- [ ] A file's timeout is not consumed by a sibling's runtime; a test asserts a slow co-runner does
      not shorten another file's budget.
- [ ] `agent` mode reports every failing file across concurrent workers; a non-`agent` mode starts no
      new files after the first failure (`scripts/run-v2-tests.test.ts` stays green).
- [ ] `validatePerFileTimeout` still throws for a timeout below `SUPPORTED_HEALTHY_FILE_BUDGET_MS`.
- [ ] Roster equivalence holds (`test/test-slices.test.ts` stays green).
- [ ] Failure output identifies which file produced it; a test asserts a failing file's output is
      attributable when other files are running concurrently.
- [ ] `bun run test` wall clock is recorded and is materially below the 697 s baseline on operator
      hardware, with the new figure written to `v2/docs/test-writing.md` alongside the existing ones.
- [ ] Five consecutive full-aggregate runs pass with identical results — no new load-dependent
      failures. Fewer than five is insufficient evidence given the flakes named above.
- [ ] `bun run check` is green, including `scripts/guard-deterministic-daemon-tests.ts`.

## Documentation updates

- `v2/docs/test-writing.md` — the concurrency model, the isolation and timeout guarantees the runner
  provides after the change, how a file is declared load-sensitive, and the before/after wall clock.
- `v2/docs/operator-runbook.md` — § Gate trust: what the gate's wall clock is now, and that a gate
  failure under a loaded machine is still worth re-running before believing.

## Prerequisites

- A recorded per-file measurement of residual versus in-file execution across the full aggregate
  roster exists (`bun run test:cost`, `v2/docs/test-cost-baseline.txt`).
- The aggregate roster is the union of the scoped slices and is asserted by a test.
- `agent` mode continues past a timed-out file while other modes stop.
- A per-file timeout with a supported floor is enforced and validated.
