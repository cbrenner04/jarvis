---
name: aggregate-test-cost-is-measured-per-file
---

# Aggregate suite reports per-file spawn overhead versus in-file execution

## Problem

`bun run test` takes 697 s (2026-07-26, 210 files, exit 0) on operator hardware. The only
per-file breakdown that exists is for the v2 slice (84 s wall clock vs 11.7 s reported test
time across 85 files), and the "~86% is spawn" figure for the aggregate is an extrapolation
from it. `runV2TestFiles` (`scripts/run-v2-tests.ts:55`) spawns one `bun test <file>` per file
serially for the whole aggregate roster, but nothing records where that time actually goes, so
a runner change would be optimizing against a guess.

## Decisions

- Measure across the full aggregate roster (`aggregateTestFiles()` in `scripts/run-tests.ts`),
  not the v2 slice — rules out extrapolating the v2 ratio to v1/shared/harness files, which
  include the ~120 s `v1/test/run.test.ts` outlier.
- Report per-file wall clock and per-file in-file execution time separately, with overhead as
  their difference — rules out a single total-only timing that cannot attribute cost.
- The measurement is a repeatable command, not a one-off transcript — rules out pasting hand-run
  `time` output that cannot be re-run to produce the after figure.
- Measuring does not change what the aggregate runs or its exit code — rules out folding the
  measurement into the runner's normal path.

## Acceptance criteria

- [ ] A command reports, per aggregate test file, wall clock and in-file reported execution time,
      plus roster totals for both and the overhead between them.
- [ ] A test drives the reporter over fixture spawn results and asserts the per-file and total
      overhead figures; it fails against the pre-change code (no reporter exists).
- [ ] Inverting the overhead computation fails that test.
- [ ] A file whose in-file time cannot be parsed from `bun test` output is reported as unparsed
      rather than counted as zero execution time.
- [ ] `v2/docs/test-writing.md` records the measured aggregate totals: wall clock, summed in-file
      execution time, and spawn overhead, dated and attributed to operator hardware.
- [ ] `bun run test` still runs the same roster and returns the same exit code (`test/test-slices.test.ts`
      and `scripts/run-v2-tests.test.ts` stay green).

## Documentation updates

- `v2/docs/test-writing.md` — what the aggregate suite costs, split into spawn overhead versus
  test execution, and how to re-run the measurement.

## Prerequisites
