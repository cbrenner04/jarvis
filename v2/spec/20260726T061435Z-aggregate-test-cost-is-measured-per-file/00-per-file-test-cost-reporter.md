# 00 - Per-file test cost reporter

## Problem

`aggregateTestFiles()` (`scripts/run-tests.ts:7`) splits the roster into `agent` and `integration`
files. `runV2TestFiles` (`scripts/run-v2-tests.ts:55`) spawns the `agent` half serially, one
`bun test <file>` per file, under a 180 s per-file timeout, with `stdio: "inherit"`. The
`integration` half is spawned separately by the `runBunTest` loop in `scripts/run-tests.ts:15`,
also one `bun test <file>` per file with `stdio: "inherit"`, but with **no per-file timeout**.
Neither path records where its time goes, so the "~86% is spawn" figure for the aggregate is
extrapolated from a per-file breakdown that exists only for the v2 slice. Attributing cost needs
two numbers per file: wall clock of the spawn, and the in-file execution time `bun test` reports
in its `Ran N tests across M files. [X]` summary line (`[35.00ms]` / `[1.20s]` forms).

## Decisions

- New standalone script `scripts/measure-test-cost.ts`, wired as `test:cost` in `package.json` —
  rules out instrumenting `runV2TestFiles` or the `runBunTest` loop, either of which would change
  what `bun run test` runs.
- The measurement spawns its own `bun test <file>` per file over `aggregateTestFiles()` (agent +
  integration), capturing both stdout and stderr instead of inheriting them — rules out reusing
  `runV2TestFiles`/`runBunTest`, whose inherited stdio makes the summary line unparseable.
- The per-file wall-clock/in-file split is a neutral **residual**, not "spawn overhead": report it
  as `residualMs = wallClockMs - inFileMs` and document in one sentence that it contains process
  spawn, module resolution, transpile, import side effects, and teardown — not spawn cost alone.
  This spec measures the residual; it does not conclude what fraction of it a shared-process
  runner would eliminate.
- Per-file bound: reuse `runV2TestFiles`'s existing 180 s (`SUPPORTED_HEALTHY_FILE_BUDGET_MS`,
  `scripts/run-v2-tests.ts:5`) as the measurement's own per-file timeout, applied uniformly to
  agent and integration files alike (the integration path has none today) — rules out a hang in
  one file silently blocking the ~12-minute roster run with no signal. A timed-out file is
  reported with its own status (`timedOut: true`) distinct from both `unparsed` and a normal
  result, carries its wall clock (the timeout bound) but no in-file time, and is excluded from the
  in-file and residual totals the same way an unparsed file is — a timeout must never render as
  zero execution time.
- Summary-line parsing looks for a generic `<number><unit>` duration token (`ms` or `s`, decimal
  allowed) anywhere in the captured combined output, not an enumerated match against the exact
  known-good forms — rules out an assumption that the largest contributor (`v1/test/run.test.ts`,
  ~120 s) or any other file emits one of only two hand-picked shapes.
- Optional positional file arguments override the roster (default: full aggregate roster). This is
  the cheap real-output smoke path against actual `bun test` invocations — the full-roster run
  costs ~12 minutes, so day-to-day verification and the fixture-driven test below exercise the
  parser without paying that cost.
- A file whose summary line does not parse (and is not a timeout) is reported `unparsed` and
  excluded from the in-file and residual totals (its wall clock still counts) — rules out
  defaulting it to 0 ms, which would silently inflate the measured residual.
- A non-zero exit from a measured file does not stop the roster and does not fail the command; the
  measurement reports timings, not pass/fail — rules out inheriting the runner's fail-fast, which
  would truncate the roster on the first flake.
- Parsing and summarization are pure exported functions over spawn results, so the test drives them
  with fixtures — rules out a test that spawns real `bun test` processes. Because nothing in
  `aggregateTestFiles()` walks `scripts/`, a test placed at `scripts/measure-test-cost.test.ts`
  would never run under `bun run test` or CI test-scope selection (a pre-existing condition: other
  `scripts/*.test.ts` files, e.g. `scripts/run-v2-tests.test.ts`, are in the same position today).
  The reporter's pure functions therefore live in `scripts/measure-test-cost.ts` but the test file
  is placed at `test/measure-test-cost.test.ts`, inside the root `test/` directory that
  `aggregateTestFiles()` already walks via `walkTestFiles("test")` — this makes the failing-test
  requirement below inert-proof without changing what the aggregate roster walks.
- Output rows are emitted in a stable order (the roster's own file order) so two runs of the same
  roster are diffable — needed by subspec 01's committed artifact.

## Acceptance criteria

- [ ] `bun run test:cost` reports, per aggregate test file, wall clock and in-file reported
      execution time, plus roster totals for both and the residual between them.
- [ ] Passing file paths as arguments measures only those files instead of the full aggregate roster.
- [ ] A file whose `bun test` summary line cannot be parsed is reported as unparsed and is excluded
      from the in-file and residual totals rather than counted as zero execution time.
- [ ] A file that exceeds the per-file timeout is reported as timed out (not unparsed, not zero
      execution time) and is excluded from the in-file and residual totals; the roster continues
      past it.
- [ ] A new test in `test/measure-test-cost.test.ts` drives the reporter over fixture spawn results
      (including `ms` and `s` summary forms, an unparseable one, and a timed-out one) and asserts
      the per-file and total wall-clock, in-file, and residual figures; it fails against the
      pre-change code (no reporter exists).
- [ ] Inverting the residual computation (`inFileMs - wallClockMs`) fails that test, inverting the
      unparsed guard so unparsed files count as 0 ms fails it, and inverting the timeout guard so
      timed-out files count as 0 ms or as unparsed fails it too.
- [ ] `bun run test` runs the same roster and returns the same exit code: `test/test-slices.test.ts`
      and `scripts/run-v2-tests.test.ts` stay green.

## Documentation updates

- `v2/docs/test-writing.md` — the `test:cost` command exists, what it reports (including the
  residual's definition and that it is not "spawn overhead"), and that it does not affect
  `bun run test`. Measured numbers land in subspec 01.
