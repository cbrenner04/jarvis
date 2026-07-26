# The test suite's wall clock is process spawn, not test execution

## Problem

The aggregate `bun run test` takes **11 min 37 s** (measured 2026-07-26, 210 files, 0 failures,
exit 0) on operator hardware. Almost none of that is running tests.

Measured on the v2 slice the same day:

| measure | value |
| --- | --- |
| `bun run test:v2` wall clock | **84 s** |
| sum of per-file reported test time | **11.7 s** |
| files | 85 |
| `bun run test:integration:v2` wall clock | 6 s |

So ~86% of the v2 slice's wall clock is process startup, not assertions. `runV2TestFiles`
(`scripts/run-v2-tests.ts:55`) spawns `bun test <file>` once per file in a `for` loop, serially:

```ts
for (const file of files) {
  const result = spawn("bun", ["test", file], { stdio: "inherit", timeout: PER_FILE_TIMEOUT_MS, ... });
```

Extrapolated across 210 aggregate files, the dominant cost of the ready gate is spawning ~210 bun
processes one at a time.

This is the root cost behind several downstream workarounds: per-step gate budgets sized in the
10–15 minute range, a run ceiling sized to tens of minutes, and gate timeouts treated as retryable
infrastructure failures (#2137). Each of those manages the symptom.

**The per-file spawn is not incidental — it buys isolation and a per-file timeout.** Files run under
`PER_FILE_TIMEOUT_MS` with a `SUPPORTED_HEALTHY_FILE_BUDGET_MS` floor, and "agent" mode continues past
a timed-out file to report all failures. Any change must keep those properties; this seed is not a
request to replace the loop with a single `bun test`.

## Decisions

- Establish where the time actually goes before changing the runner: measure per-file spawn overhead
  versus in-file execution across the aggregate, not just the v2 slice. Rules out optimizing against
  the v2 extrapolation alone.
- Reduce spawn count while preserving per-file isolation guarantees and the per-file timeout —
  candidates to evaluate, not to assume: batching files per process with a per-batch timeout, running
  independent files concurrently with a bounded pool, or reserving one-process-per-file for the files
  that actually require isolation. Rules out a change that drops the timeout or the
  continue-past-failure behavior in `agent` mode.
- Any batching or concurrency must keep the determinism guarantees the suite already depends on:
  `scripts/guard-deterministic-daemon-tests.ts` exists because timing-sensitive tests have reddened
  `main`, and `.sandbox-unrunnable.test.ts` files are separated deliberately. Rules out concurrency
  that reintroduces load-dependent flakes — note `daemon-lifecycle … captures a real child's stdout
  into logPath` already fails under load and passes 23/23 idle.
- Success is measured, not assumed: the aggregate's wall clock is reported before and after.
- Out of scope: the ready gate's budget and ceiling values, which are a consequence of this cost.

## Acceptance criteria

- [ ] A measurement records per-file spawn overhead versus in-file execution time across the full
      aggregate, and the spec states both numbers before any runner change lands.
- [ ] Aggregate `bun run test` wall clock is materially below the 697 s baseline on operator hardware,
      with the new figure recorded.
- [ ] Per-file timeout enforcement survives: a file exceeding its budget is still killed and reported,
      and the `SUPPORTED_HEALTHY_FILE_BUDGET_MS` floor still rejects an undercutting timeout.
- [ ] `agent` mode still continues past a timed-out file and reports every failure rather than
      stopping at the first.
- [ ] Roster equivalence holds: the aggregate still runs exactly the union of the scoped slices
      (`test/test-slices.test.ts` stays green).
- [ ] Running the full aggregate 3× consecutively yields 3 identical pass results — no new
      load-dependent flakes.

## Documentation updates

- `v2/docs/test-writing.md` — what the aggregate suite costs and why, and the isolation guarantees the
  runner provides.
