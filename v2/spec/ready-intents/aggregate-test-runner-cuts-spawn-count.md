---
name: aggregate-test-runner-cuts-spawn-count
---

# Aggregate suite runs in materially fewer processes without losing isolation guarantees

## Problem

`runV2TestFiles` (`scripts/run-v2-tests.ts:55`) spawns `bun test <file>` once per file in a serial
`for` loop, so the aggregate's 697 s wall clock is dominated by ~210 sequential process starts
rather than assertions. The downstream ready-gate budgets and the retryable-timeout treatment of
gate failures (#2137) manage that symptom.

The per-file spawn is load-bearing: it provides isolation and a per-file timeout
(`PER_FILE_TIMEOUT_MS`, floored by `SUPPORTED_HEALTHY_FILE_BUDGET_MS`), and `agent` mode continues
past a timed-out file so every failure is reported. `v1` agent mode already runs one
`bun test --parallel <files>` process, so a single-process aggregate is not the target either.

## Decisions

- Pick the spawn-reduction shape from the recorded measurement, not a priori — batching per
  process with a per-batch timeout, a bounded concurrent pool, or per-file processes only for
  files that need isolation are all admissible; rules out committing to one shape before the
  numbers exist.
- Per-file (or per-batch) timeout enforcement and the `SUPPORTED_HEALTHY_FILE_BUDGET_MS` floor
  survive, and `validatePerFileTimeout` still rejects an undercutting timeout — rules out buying
  speed by dropping the timeout.
- `agent` mode still continues past a timed-out unit and reports every failure; non-`agent` modes
  still stop — rules out a batching shape that loses the failing file's identity or fails fast in
  `agent` mode.
- Files the determinism guard protects and `.sandbox-unrunnable.test.ts` files keep their current
  separation; any file that only passes idle (e.g. `daemon-lifecycle … captures a real child's
  stdout into logPath`) stays isolated from added load — rules out concurrency that reintroduces
  load-dependent flakes.
- Deferred to first consumer: whether isolation-required files are declared by filename
  convention or an explicit list — pin when the chosen shape needs the distinction.
- Out of scope: ready-gate budget and ceiling values.

## Acceptance criteria

- [ ] The aggregate runs the full roster in materially fewer spawned processes than one per file;
      a test asserts the spawn count for a fixture roster and fails against the pre-change runner.
- [ ] A unit exceeding its timeout is still killed and reported by name; a test drives a timing-out
      fixture and asserts the file appears in the failure output.
- [ ] `agent` mode continues past a timed-out unit and reports every subsequent failure; a
      non-`agent` mode stops at the first (`scripts/run-v2-tests.test.ts` stays green).
- [ ] `validatePerFileTimeout` still throws for a timeout below `SUPPORTED_HEALTHY_FILE_BUDGET_MS`.
- [ ] Roster equivalence holds: the aggregate runs exactly the union of the scoped slices
      (`test/test-slices.test.ts` stays green).
- [ ] `bun run test` wall clock is recorded and is materially below the 697 s baseline on operator
      hardware.
- [ ] Three consecutive full-aggregate runs all pass with identical results — no new
      load-dependent failures.
- [ ] `bun run check` is green, including `scripts/guard-deterministic-daemon-tests.ts`.

## Documentation updates

- `v2/docs/test-writing.md` — the isolation and timeout guarantees the runner provides after the
  change, which files stay in their own process and why, and the before/after aggregate wall clock.

## Prerequisites

- A recorded measurement of per-file spawn overhead versus in-file execution across the full aggregate roster exists.
- The aggregate roster is the union of the scoped slices and is asserted by a test.
- `agent` mode continues past a timed-out file while other modes stop.
