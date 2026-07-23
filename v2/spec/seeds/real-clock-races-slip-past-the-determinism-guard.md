# A real-clock race reddens main, and the determinism guard cannot see it

## Problem

`write loop > lets an observed abort win before the watchdog, but not after it`
(`v2/src/execution/write-loop.test.ts`) races a 5 ms `iterationTimeoutMs` against a real
`setTimeout(() => lateAbort.abort(), 40)` and asserts the watchdog wins:

```ts
const lateAbort = new AbortController();
setTimeout(() => lateAbort.abort(), 40);
const late = await executeWriteLoop({ …, signal: lateAbort.signal, iterationTimeoutMs: 5 });
expect(late).toMatchObject({ kind: "iteration_timeout", resumable: false });
```

The 35 ms margin is real wall clock on a shared CI runner. When the write step's own work exceeds
40 ms the abort lands first and the loop returns `progress` / `resumable: true` instead.

Observed 2026-07-23 on `main` (run 30023800942): 80 pass, 1 fail, with exactly that diff
(`kind: "iteration_timeout"` → `"progress"`). The failing commit was **#2057, a markdown-only spec
change touching no code**; the identical code passed on `main` 24 minutes earlier, and the test
passes 5/5 locally. So it reddens `main` on unrelated merges, which is the expensive part — a red
`main` is indistinguishable from a real regression until someone reads the diff.

**The guard that exists to prevent this cannot see it.**
`scripts/guard-deterministic-daemon-tests.ts` covers `v2/src/execution/**`, but it matches only two
constructs: `Bun.sleep(` and `await new Promise((resolve) => setTimeout(…))`. A bare
`setTimeout(() => …, ms)` that schedules a real-clock side effect the assertion depends on matches
neither, so the guard passes a test whose correctness is a wall-clock bet. Fixing the one test
leaves the pattern free to come back.

## Decisions

- Rewrite the case so the abort-vs-watchdog ordering is driven by injected control, not by two real
  timers racing: the test must decide which fires first, not the scheduler. Rules out widening the
  5 ms/40 ms margin, which only lowers the flake rate.
- Both orderings stay covered — abort-wins-first and watchdog-wins-first are the point of the test;
  rules out deleting the late-abort half to make it green.
- Extend the determinism guard to flag a bare `setTimeout`/`setInterval` in a guarded test file
  whose callback is not awaited through a bounded condition — the construct the current two regexes
  miss. Rules out fixing only the one test.
- The guard change must not flag legitimate uses: `setTimeout` inside a bounded polling helper, and
  production `setInterval` wiring under `v2/src/**` that is not a test file, stay clean. Rules out a
  blanket ban on the identifier.
- Out of scope: whether `iterationTimeoutMs` should be injectable as a fake clock across the whole
  write loop. If that falls out of the fix, fine; it is not the ask.

## Acceptance criteria

- [ ] `write loop > lets an observed abort win before the watchdog, but not after it` no longer
      depends on real elapsed time: with the process artificially stalled well past every timeout in
      the test, it still passes. Both orderings remain asserted.
- [ ] Running the rewritten case 50 times consecutively yields 50 passes.
- [ ] `scripts/guard-deterministic-daemon-tests.ts` reports a violation for a bare
      `setTimeout(() => …, ms)` in a guarded test file whose effect is not awaited through a bounded
      condition; a fixture exercising the pre-fix `write-loop.test.ts` pattern is flagged.
- [ ] The guard still reports no violation for a bounded polling helper that uses `setTimeout`
      inside a `Date.now() < deadline` or `signal?.aborted` loop — the negative case proves the new
      rule is not a blanket ban.
- [ ] Inverting the new guard rule fails a test in `scripts/guard-deterministic-daemon-tests.test.ts`.
- [ ] `bun run check` (which runs the guard) is green on the whole tree after the rewrite — no other
      guarded file trips the new rule, or any that does is fixed in the same change.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` § Deterministic daemon and execution tests — a bare `setTimeout` whose
  real-clock firing an assertion depends on is a timer-backed wait, and is guarded.

## Prerequisites

- `scripts/guard-deterministic-daemon-tests.ts` covers `v2/src/execution/**` and runs under
  `bun run check`.
